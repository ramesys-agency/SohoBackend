import { randomUUID } from "node:crypto";
import { Prisma, ReservationStatus } from "@prisma/client";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { BadRequestError, ConflictError, NotFoundError } from "../../core/errors/http-errors.js";
import type { PrismaService } from "../../core/services/index.js";

/** One line of a checkout — a variant and how many units of it are wanted. */
export interface CheckoutLine {
    variantId: string;
    quantity: number;
}

export interface ReserveInput {
    /** Buy-now checkout. Omit to reserve the user's whole cart. */
    buyNow?: { variantId: string; quantity?: number | undefined } | undefined;
}

export interface ShortLine {
    variantId: string;
    productName: string;
    variantLabel: string;
    requested: number;
    available: number;
}

export interface ReservationSummary {
    /** Null when reservations are switched off — clients then skip the countdown. */
    checkoutId: string | null;
    enabled: boolean;
    expiresAt: Date | null;
    ttlSeconds: number;
    items: CheckoutLine[];
}

/** How many active, unexpired units are held per variant. */
export type ReservedMap = Map<string, number>;

const MUTEX_TTL_SECONDS = 5;
const SERIALIZATION_RETRIES = 3;

/**
 * Short-lived stock holds taken when a customer enters checkout.
 *
 * Reservations never touch `ProductVariant.stockQty` — they sit on top of it, so
 * an expired hold costs nothing to clean up and the stock number keeps meaning
 * "units we own". Availability is `stockQty − active holds`, and only order
 * placement decrements stock for real.
 *
 * Correctness comes from a Serializable transaction plus the conditional
 * decrement in OrderService, not from Redis: the mutex below is an optimisation
 * that keeps two shoppers from bouncing off each other, and Redis is optional
 * in this deployment.
 */
export class CheckoutService {
    private prisma: PrismaService = prisma;

    get ttlMinutes(): number {
        return config.checkout.reservationTtlMinutes;
    }

    // --- Public API ---------------------------------------------------------

    async reserve(userId: string, input: ReserveInput): Promise<ReservationSummary> {
        const lines = await this.resolveLines(userId, input);

        if (!config.checkout.reservationEnabled) {
            return {
                checkoutId: null,
                enabled: false,
                expiresAt: null,
                ttlSeconds: 0,
                items: lines,
            };
        }

        const checkoutId = randomUUID();
        const variantIds = [...new Set(lines.map((l) => l.variantId))].sort();

        const expiresAt = await this.withVariantMutexes(variantIds, () =>
            this.runSerializable(async (tx) => {
                const now = new Date();

                await this.expireStale(tx, variantIds, now);

                // A user has one live checkout at a time. Releasing their other
                // holds first means re-entering checkout (or changing the cart
                // and coming back) renews rather than double-books.
                await tx.stockReservation.updateMany({
                    where: { userId, status: ReservationStatus.active },
                    data: { status: ReservationStatus.released },
                });

                const shortages = await this.findShortages(tx, lines, now);
                if (shortages.length) {
                    throw new ConflictError("Some items are no longer available", {
                        items: shortages,
                    });
                }

                const expiry = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

                await tx.stockReservation.createMany({
                    data: lines.map((line) => ({
                        checkoutId,
                        userId,
                        variantId: line.variantId,
                        quantity: line.quantity,
                        expiresAt: expiry,
                    })),
                });

                return expiry;
            })
        );

        logger.info("Checkout stock reserved", {
            checkoutId,
            userId,
            lines: lines.length,
            expiresAt,
        });

        return {
            checkoutId,
            enabled: true,
            expiresAt,
            ttlSeconds: Math.round((expiresAt.getTime() - Date.now()) / 1000),
            items: lines,
        };
    }

    /**
     * Push the hold out by another TTL. Bounded by CHECKOUT_MAX_HOLD_MINUTES so
     * an app left open on the payment screen can't sit on stock forever.
     */
    async renew(userId: string, checkoutId: string): Promise<ReservationSummary> {
        const client = this.prisma.getClient();
        const now = new Date();

        const reservations = await client.stockReservation.findMany({
            where: { checkoutId, userId, status: ReservationStatus.active },
        });

        if (!reservations.length) {
            throw new NotFoundError("Checkout hold not found or already released");
        }

        // Already lapsed — the units may belong to someone else now, so the
        // client has to go through reserve() again rather than silently extend.
        if (reservations.some((r) => r.expiresAt <= now)) {
            throw new ConflictError("Checkout hold has expired");
        }

        const startedAt = reservations.reduce(
            (earliest, r) => (r.createdAt < earliest ? r.createdAt : earliest),
            reservations[0]!.createdAt
        );
        const maxHoldMs = config.checkout.maxHoldMinutes * 60 * 1000;
        if (now.getTime() - startedAt.getTime() >= maxHoldMs) {
            throw new ConflictError("Maximum checkout hold time reached");
        }

        const expiresAt = new Date(now.getTime() + this.ttlMinutes * 60 * 1000);

        await client.stockReservation.updateMany({
            where: { checkoutId, userId, status: ReservationStatus.active },
            data: { expiresAt },
        });

        return {
            checkoutId,
            enabled: true,
            expiresAt,
            ttlSeconds: Math.round((expiresAt.getTime() - now.getTime()) / 1000),
            items: reservations.map((r) => ({ variantId: r.variantId, quantity: r.quantity })),
        };
    }

    /** Current state of a hold — drives the countdown in the app. */
    async status(userId: string, checkoutId: string) {
        const reservations = await this.prisma.getClient().stockReservation.findMany({
            where: { checkoutId, userId },
        });

        if (!reservations.length) {
            throw new NotFoundError("Checkout hold not found");
        }

        const now = new Date();
        const active = reservations.filter(
            (r) => r.status === ReservationStatus.active && r.expiresAt > now
        );
        const expiresAt = active.length
            ? active.reduce(
                  (earliest, r) => (r.expiresAt < earliest ? r.expiresAt : earliest),
                  active[0]!.expiresAt
              )
            : null;

        return {
            checkoutId,
            active: active.length > 0,
            consumed: reservations.some((r) => r.status === ReservationStatus.consumed),
            expiresAt,
            ttlSeconds: expiresAt
                ? Math.max(0, Math.round((expiresAt.getTime() - now.getTime()) / 1000))
                : 0,
            items: reservations.map((r) => ({
                variantId: r.variantId,
                quantity: r.quantity,
                status: r.status,
            })),
        };
    }

    /** Customer backed out of checkout — hand the units back immediately. */
    async release(userId: string, checkoutId: string): Promise<{ released: number }> {
        const { count } = await this.prisma.getClient().stockReservation.updateMany({
            where: { checkoutId, userId, status: ReservationStatus.active },
            data: { status: ReservationStatus.released },
        });

        return { released: count };
    }

    // --- Helpers shared with other modules -----------------------------------

    /**
     * Units currently held per variant, optionally ignoring one checkout's own
     * holds (used when that checkout is about to be converted into an order).
     */
    async getReservedQuantities(
        client: Prisma.TransactionClient | ReturnType<PrismaService["getClient"]>,
        variantIds: string[],
        options?: { excludeCheckoutId?: string | undefined }
    ): Promise<ReservedMap> {
        if (!variantIds.length) return new Map();

        const grouped = await client.stockReservation.groupBy({
            by: ["variantId"],
            where: {
                variantId: { in: variantIds },
                status: ReservationStatus.active,
                expiresAt: { gt: new Date() },
                ...(options?.excludeCheckoutId && {
                    checkoutId: { not: options.excludeCheckoutId },
                }),
            },
            _sum: { quantity: true },
        });

        return new Map(grouped.map((row) => [row.variantId, row._sum.quantity ?? 0]));
    }

    /**
     * Mark a checkout's holds as spent by an order. Throws when the hold no
     * longer covers what is being ordered, so the caller can tell the customer
     * to review their cart instead of silently overselling.
     */
    async consumeForOrder(
        tx: Prisma.TransactionClient,
        params: { checkoutId: string; userId: string; lines: CheckoutLine[]; orderId: string }
    ): Promise<void> {
        const { checkoutId, userId, lines, orderId } = params;
        const now = new Date();

        const reservations = await tx.stockReservation.findMany({
            where: { checkoutId, userId, status: ReservationStatus.active },
        });

        if (!reservations.length) {
            throw new ConflictError("Your checkout hold expired — please review your cart");
        }

        if (reservations.some((r) => r.expiresAt <= now)) {
            throw new ConflictError("Your checkout hold expired — please review your cart");
        }

        const held = new Map<string, number>();
        for (const r of reservations) {
            held.set(r.variantId, (held.get(r.variantId) ?? 0) + r.quantity);
        }

        // The basket can change between reserving and paying (another tab, a
        // second device). Anything not covered by the hold is not protected.
        const uncovered = lines.filter((line) => (held.get(line.variantId) ?? 0) < line.quantity);
        if (uncovered.length) {
            throw new ConflictError(
                "Your checkout hold no longer matches your cart — please review it",
                { items: uncovered }
            );
        }

        await tx.stockReservation.updateMany({
            where: { checkoutId, userId, status: ReservationStatus.active },
            data: { status: ReservationStatus.consumed, orderId },
        });
    }

    /** Flip lapsed holds to `expired`. Used by the sweeper and before each check. */
    async expireStale(
        tx: Prisma.TransactionClient | ReturnType<PrismaService["getClient"]>,
        variantIds: string[] | undefined,
        now = new Date()
    ): Promise<number> {
        const { count } = await tx.stockReservation.updateMany({
            where: {
                status: ReservationStatus.active,
                expiresAt: { lt: now },
                ...(variantIds?.length && { variantId: { in: variantIds } }),
            },
            data: { status: ReservationStatus.expired },
        });

        return count;
    }

    // --- Internals -----------------------------------------------------------

    private async resolveLines(userId: string, input: ReserveInput): Promise<CheckoutLine[]> {
        if (input.buyNow?.variantId) {
            const quantity = input.buyNow.quantity ?? 1;
            if (quantity < 1) throw new BadRequestError("Quantity must be at least 1");

            const variant = await this.prisma.getClient().productVariant.findUnique({
                where: { id: input.buyNow.variantId },
                select: { id: true },
            });
            if (!variant) throw new NotFoundError("Product variant not found");

            return [{ variantId: variant.id, quantity }];
        }

        const cartItems = await this.prisma.getClient().cartItem.findMany({
            where: { userId },
            select: { variantId: true, quantity: true },
        });

        if (!cartItems.length) {
            throw new BadRequestError("Cannot start checkout with an empty cart");
        }

        return cartItems.map((item) => ({ variantId: item.variantId, quantity: item.quantity }));
    }

    private async findShortages(
        tx: Prisma.TransactionClient,
        lines: CheckoutLine[],
        now: Date
    ): Promise<ShortLine[]> {
        const variantIds = [...new Set(lines.map((l) => l.variantId))];

        const variants = await tx.productVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
                id: true,
                stockQty: true,
                size: true,
                colorName: true,
                product: { select: { name: true } },
            },
        });

        const grouped = await tx.stockReservation.groupBy({
            by: ["variantId"],
            where: {
                variantId: { in: variantIds },
                status: ReservationStatus.active,
                expiresAt: { gt: now },
            },
            _sum: { quantity: true },
        });
        const reserved = new Map(grouped.map((row) => [row.variantId, row._sum.quantity ?? 0]));

        const shortages: ShortLine[] = [];

        for (const line of lines) {
            const variant = variants.find((v) => v.id === line.variantId);
            if (!variant) {
                throw new NotFoundError("Product variant not found");
            }

            const available = variant.stockQty - (reserved.get(line.variantId) ?? 0);
            if (available < line.quantity) {
                shortages.push({
                    variantId: line.variantId,
                    productName: variant.product.name,
                    variantLabel: [variant.size, variant.colorName].filter(Boolean).join(" / "),
                    requested: line.quantity,
                    available: Math.max(0, available),
                });
            }
        }

        return shortages;
    }

    /**
     * Serializable is what actually stops two checkouts from both passing the
     * availability check for the last unit. Postgres reports the loser as a
     * serialization failure (Prisma P2034), which is safe to retry.
     */
    private async runSerializable<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        let lastError: unknown;

        for (let attempt = 0; attempt < SERIALIZATION_RETRIES; attempt++) {
            try {
                return await this.prisma.getClient().$transaction(fn, {
                    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                });
            } catch (error) {
                const code = (error as { code?: string }).code;
                if (code !== "P2034") throw error;

                lastError = error;
                // Small jittered backoff so the retries don't collide again.
                await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 50));
            }
        }

        logger.warn("Checkout reservation gave up after serialization conflicts", {
            error: lastError instanceof Error ? lastError.message : String(lastError),
        });
        throw new ConflictError("That item is being checked out by someone else — please retry");
    }

    /**
     * Best-effort per-variant mutex. Sorted acquisition order keeps two baskets
     * sharing variants from deadlocking each other. Redis being unavailable is
     * not fatal — the transaction above still guarantees correctness.
     */
    private async withVariantMutexes<T>(variantIds: string[], fn: () => Promise<T>): Promise<T> {
        if (!config.redis.enabled) return fn();

        const acquired: string[] = [];

        try {
            for (const variantId of variantIds) {
                const key = `checkout:lock:${variantId}`;
                try {
                    const ok = await redis.setNX(key, Date.now(), MUTEX_TTL_SECONDS);
                    if (!ok) {
                        throw new ConflictError(
                            "That item is being checked out by someone else — please retry"
                        );
                    }
                    acquired.push(key);
                } catch (error) {
                    if (error instanceof ConflictError) throw error;
                    logger.warn("Checkout mutex unavailable — proceeding without it", {
                        variantId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            return await fn();
        } finally {
            for (const key of acquired) {
                try {
                    await redis.del(key);
                } catch (error) {
                    logger.warn("Failed to release checkout mutex", {
                        key,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }
        }
    }
}
