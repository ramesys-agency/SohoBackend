import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { CheckoutService } from "./checkout.service.js";

const LOCK_KEY = "checkout:reservation-sweep-lock";

export interface SweepResult {
    expired: number;
    /** True when another instance held the lock and this run was a no-op. */
    skipped: boolean;
}

/**
 * Flips lapsed checkout holds from `active` to `expired`.
 *
 * This is housekeeping, not correctness: every availability check already
 * filters on `expiresAt > now()`, so a dead sweeper can never cause a phantom
 * hold. It exists to keep the table honest and cheap to query.
 *
 * Same shape as OrderStatusPoller — interval in-process, Redis lock across
 * replicas, plus an admin endpoint so an external cron can drive it on hosts
 * that suspend idle processes.
 */
export class ReservationSweeper {
    private readonly checkout = new CheckoutService();
    private timer?: NodeJS.Timeout | undefined;
    private running = false;

    start(): void {
        if (!config.checkout.reservationEnabled) {
            logger.info("Reservation sweeper disabled (CHECKOUT_RESERVATION_ENABLED=false)");
            return;
        }

        const intervalMs = config.checkout.sweepIntervalSeconds * 1000;
        logger.info(
            `Reservation sweeper started (Interval: ${config.checkout.sweepIntervalSeconds}s, TTL: ${config.checkout.reservationTtlMinutes}m)`
        );

        this.timer = setInterval(() => {
            void this.runOnce().catch((error) => {
                logger.error("Reservation sweep failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
            logger.info("Reservation sweeper stopped");
        }
    }

    async runOnce(): Promise<SweepResult> {
        if (this.running) {
            return { expired: 0, skipped: true };
        }

        if (!(await this.acquireLock())) {
            return { expired: 0, skipped: true };
        }

        this.running = true;

        try {
            const expired = await this.checkout.expireStale(prisma.getClient(), undefined);

            if (expired) {
                logger.info("Reservation sweep finished", { expired });
            }

            return { expired, skipped: false };
        } finally {
            this.running = false;
            await this.releaseLock();
        }
    }

    private async acquireLock(): Promise<boolean> {
        if (!config.redis.enabled) return true;

        try {
            // TTL is a safety net: a process that dies mid-sweep must not block
            // every future run.
            const ttl = Math.max(30, config.checkout.sweepIntervalSeconds - 5);
            return await redis.setNX(LOCK_KEY, Date.now(), ttl);
        } catch (error) {
            logger.warn("Could not acquire reservation sweep lock — proceeding without it", {
                error: error instanceof Error ? error.message : String(error),
            });
            return true;
        }
    }

    private async releaseLock(): Promise<void> {
        if (!config.redis.enabled) return;

        try {
            await redis.del(LOCK_KEY);
        } catch (error) {
            logger.warn("Failed to release reservation sweep lock", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export const reservationSweeper = new ReservationSweeper();
