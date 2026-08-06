import { PrismaService } from "../../core/services/index.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../core/errors/http-errors.js";
import { NotificationService } from "../notification/notification.service.js";
import { logger } from "../../config/logger.js";
import { Prisma, ReturnStatus } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { AdminCreateReturnDto, AdminUpdateReturnDto, ReturnFilterParams } from "./returns.types.js";

/**
 * A return is only ever created by an admin. Customers reach out over WhatsApp
 * (see the app's Help & Support screen) and the admin records what is coming
 * back; the customer then tracks it in the app. There is deliberately no
 * customer-facing create endpoint.
 */

/** Returns in these states no longer hold a unit of stock "in flight". */
const CLOSED_STATUSES: ReturnStatus[] = [ReturnStatus.rejected];

/** Allowed status moves. A rejected or refunded return is final. */
const TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
    [ReturnStatus.requested]: [ReturnStatus.approved, ReturnStatus.rejected],
    [ReturnStatus.approved]: [ReturnStatus.refunded, ReturnStatus.rejected],
    [ReturnStatus.rejected]: [],
    [ReturnStatus.refunded]: [],
};

const RETURN_INCLUDE = {
    orderItem: {
        include: {
            product: { select: { id: true, name: true } },
            variant: { select: { id: true, size: true, colorName: true } },
            order: {
                select: {
                    id: true,
                    orderCode: true,
                    status: true,
                    totalAmount: true,
                    createdAt: true,
                    userId: true,
                    user: { select: { id: true, fullName: true, email: true, phone: true } },
                },
            },
        },
    },
} satisfies Prisma.ReturnInclude;

export class ReturnService {
    private prisma: PrismaService = prisma;
    private notificationService: NotificationService = new NotificationService();

    /**
     * Records one or more returns against an order.
     *
     * The whole submission is atomic: either every line is recorded (and the
     * order status flips when the order is fully returned) or nothing is.
     */
    async adminCreateReturns(orderId: string, dto: AdminCreateReturnDto) {
        const lines = dto.items ?? [];
        if (lines.length === 0) {
            throw new BadRequestError("At least one item is required to record a return");
        }

        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            include: {
                items: { include: { returns: true } },
            },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        if (order.status === "cancelled") {
            throw new BadRequestError("A cancelled order cannot be returned");
        }

        // Remaining eligible units per item, decremented as we walk the payload so
        // two lines against the same item can't together exceed what was bought.
        const remaining = new Map<string, number>();
        for (const item of order.items) {
            remaining.set(item.id, item.quantity - liveReturnedUnits(item.returns));
        }

        const note = dto.note?.trim();
        const creates: Prisma.ReturnCreateManyInput[] = [];

        for (const line of lines) {
            const orderItem = order.items.find((i) => i.id === line.orderItemId);
            if (!orderItem) {
                throw new BadRequestError(`Order item ${line.orderItemId} does not belong to this order`);
            }

            const reason = line.reason?.trim();
            if (!reason) {
                throw new BadRequestError("A reason is required for every returned item");
            }

            const quantity = line.quantity ?? 1;
            if (!Number.isInteger(quantity) || quantity < 1) {
                throw new BadRequestError("Return quantity must be a whole number of at least 1");
            }

            const left = remaining.get(orderItem.id) ?? 0;
            if (quantity > left) {
                const label = `${orderItem.productId}`;
                throw new BadRequestError(
                    left === 0
                        ? `Every unit of item ${label} has already been returned`
                        : `Only ${left} unit(s) of item ${label} can still be returned`
                );
            }
            remaining.set(orderItem.id, left - quantity);

            creates.push({
                orderItemId: orderItem.id,
                reason,
                quantity,
                ...(note ? { note } : {}),
            });
        }

        // Fully returned = no eligible unit left anywhere on the order.
        const fullyReturned = [...remaining.values()].every((left) => left === 0);
        const flipOrder = fullyReturned && dto.markOrderReturned !== false && order.status !== "returned";

        const created = await this.prisma.getClient().$transaction(async (tx) => {
            // Created one at a time (rather than createMany) because we need the
            // rows back — createMany only reports a count.
            const rows = [];
            for (const data of creates) {
                rows.push(
                    await tx.return.create({
                        data,
                        include: RETURN_INCLUDE,
                    })
                );
            }

            if (flipOrder) {
                // Written inline rather than through OrderService.updateOrderStatus so
                // the flip is part of this transaction and the customer gets a single
                // return-specific notification instead of two overlapping ones.
                await tx.order.update({
                    where: { id: order.id },
                    data: {
                        status: "returned",
                        statusLogs: {
                            create: {
                                status: "returned",
                                note: note || "All items returned",
                            } as Prisma.OrderStatusLogCreateWithoutOrderInput,
                        },
                    },
                });
            }

            return rows;
        });

        const totalUnits = creates.reduce((sum, c) => sum + (c.quantity ?? 1), 0);
        await this.notify(order.userId, {
            orderId: order.id,
            orderCode: order.orderCode,
            status: ReturnStatus.requested,
            units: totalUnits,
            note,
        });

        logger.info("Return recorded", {
            orderId: order.id,
            lines: creates.length,
            units: totalUnits,
            orderFlipped: flipOrder,
        });

        return created;
    }

    async adminGetAllReturns(params?: ReturnFilterParams) {
        const where: Prisma.ReturnWhereInput = {};

        if (params?.status && params.status !== "all") {
            const status = parseStatus(params.status);
            where.status = status;
        }

        if (params?.search?.trim()) {
            const q = params.search.trim();
            where.orderItem = {
                OR: [
                    { order: { orderCode: { contains: q, mode: "insensitive" } } },
                    { order: { id: { contains: q, mode: "insensitive" } } },
                    { order: { user: { fullName: { contains: q, mode: "insensitive" } } } },
                    { order: { user: { email: { contains: q, mode: "insensitive" } } } },
                    { order: { user: { phone: { contains: q, mode: "insensitive" } } } },
                    { product: { name: { contains: q, mode: "insensitive" } } },
                ],
            };
        }

        return await this.prisma.getClient().return.findMany({
            where,
            include: RETURN_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
    }

    /** Every return raised against the caller's own orders. */
    async getUserReturns(userId: string) {
        return await this.prisma.getClient().return.findMany({
            where: { orderItem: { order: { userId } } },
            include: RETURN_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
    }

    async getReturnsForOrder(orderId: string, userId: string, userRole?: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            select: { id: true, userId: true },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        if (order.userId !== userId && userRole !== "admin") {
            throw new ForbiddenError("You are not authorized to view this order");
        }

        return await this.prisma.getClient().return.findMany({
            where: { orderItem: { orderId } },
            include: RETURN_INCLUDE,
            orderBy: { createdAt: "desc" },
        });
    }

    /**
     * Moves a return through requested -> approved -> refunded (or rejected).
     *
     * On `refunded` the order's payment is only marked refunded once the refunded
     * total covers the whole order — a partial return leaves the payment alone so
     * the record still reflects that money was collected.
     */
    async adminUpdateReturnStatus(returnId: string, dto: AdminUpdateReturnDto) {
        const existing = await this.prisma.getClient().return.findUnique({
            where: { id: returnId },
            include: RETURN_INCLUDE,
        });

        if (!existing) {
            throw new NotFoundError("Return not found");
        }

        const next = parseStatus(dto.status);

        if (next === existing.status) {
            throw new BadRequestError(`This return is already ${next}`);
        }

        const allowed = TRANSITIONS[existing.status];
        if (!allowed.includes(next)) {
            throw new BadRequestError(
                allowed.length === 0
                    ? `A ${existing.status} return is final and cannot be changed`
                    : `A ${existing.status} return can only move to: ${allowed.join(", ")}`
            );
        }

        const note = dto.note?.trim();
        const data: Prisma.ReturnUpdateInput = { status: next };
        if (note) {
            data.note = note;
        }

        let refundAmount: Prisma.Decimal | null = null;
        if (next === ReturnStatus.refunded) {
            refundAmount = this.resolveRefundAmount(dto.refundAmount, existing.quantity, existing.orderItem.priceAtBuy);
            data.refundAmount = refundAmount;
        }

        const order = existing.orderItem.order;

        const updated = await this.prisma.getClient().$transaction(async (tx) => {
            const result = await tx.return.update({
                where: { id: returnId },
                data,
                include: RETURN_INCLUDE,
            });

            if (next === ReturnStatus.refunded) {
                const refundedTotal = await this.sumRefunded(tx, order.id);

                if (refundedTotal.gte(order.totalAmount)) {
                    const payment = await tx.payment.findFirst({
                        where: { orderId: order.id },
                        orderBy: { createdAt: "desc" },
                    });

                    if (payment && payment.status !== "refunded") {
                        await tx.payment.update({
                            where: { id: payment.id },
                            data: { status: "refunded" },
                        });
                    }
                }
            }

            return result;
        });

        await this.notify(order.userId, {
            orderId: order.id,
            orderCode: order.orderCode,
            status: next,
            units: existing.quantity,
            note,
            ...(refundAmount ? { refundAmount: refundAmount.toString() } : {}),
        });

        return updated;
    }

    /**
     * Deletes a return recorded in error. Only untouched (`requested`) returns can
     * be removed — anything further along is part of the order's history.
     */
    async adminDeleteReturn(returnId: string) {
        const existing = await this.prisma.getClient().return.findUnique({
            where: { id: returnId },
            select: { id: true, status: true },
        });

        if (!existing) {
            throw new NotFoundError("Return not found");
        }

        if (existing.status !== ReturnStatus.requested) {
            throw new BadRequestError(
                `Only a requested return can be deleted — this one is already ${existing.status}`
            );
        }

        await this.prisma.getClient().return.delete({ where: { id: returnId } });

        return { id: returnId };
    }

    private resolveRefundAmount(
        provided: number | string | undefined,
        quantity: number,
        priceAtBuy: Prisma.Decimal
    ): Prisma.Decimal {
        if (provided === undefined || provided === null || provided === "") {
            return new Prisma.Decimal(priceAtBuy).mul(quantity);
        }

        let amount: Prisma.Decimal;
        try {
            amount = new Prisma.Decimal(provided);
        } catch {
            throw new BadRequestError("Refund amount must be a number");
        }

        if (amount.isNegative()) {
            throw new BadRequestError("Refund amount cannot be negative");
        }

        return amount;
    }

    /** Total already refunded across every return on an order. */
    private async sumRefunded(tx: Prisma.TransactionClient, orderId: string): Promise<Prisma.Decimal> {
        const refunded = await tx.return.findMany({
            where: {
                status: ReturnStatus.refunded,
                orderItem: { orderId },
            },
            select: { refundAmount: true },
        });

        return refunded.reduce(
            (sum, r) => (r.refundAmount ? sum.add(r.refundAmount) : sum),
            new Prisma.Decimal(0)
        );
    }

    private async notify(
        userId: string,
        params: {
            orderId: string;
            orderCode: string | null;
            status: ReturnStatus;
            units: number;
            note?: string | undefined;
            refundAmount?: string;
        }
    ) {
        const reference = params.orderCode || params.orderId.slice(0, 8).toUpperCase();
        const unitLabel = params.units === 1 ? "item" : `${params.units} items`;

        const messages: Record<ReturnStatus, { title: string; body: string }> = {
            [ReturnStatus.requested]: {
                title: "Return recorded",
                body: `We've recorded a return for ${unitLabel} from order #${reference}. We'll review it and update you here.`,
            },
            [ReturnStatus.approved]: {
                title: "Return approved",
                body: `Your return for order #${reference} has been approved. Any refund will follow shortly.`,
            },
            [ReturnStatus.rejected]: {
                title: "Return not approved",
                body: `We couldn't approve the return for order #${reference}.${params.note ? ` Reason: ${params.note}` : " Contact support if you have questions."}`,
            },
            [ReturnStatus.refunded]: {
                title: "Refund processed",
                body: params.refundAmount
                    ? `A refund of ৳${params.refundAmount} for order #${reference} has been processed.`
                    : `Your refund for order #${reference} has been processed.`,
            },
        };

        const message = messages[params.status];

        return await this.notificationService.createForUser({
            userId,
            title: message.title,
            body: message.body,
            type: "order",
            data: {
                orderId: params.orderId,
                orderCode: params.orderCode,
                returnStatus: params.status,
                screen: "orders",
            },
        });
    }
}

/** Units of an item that are returned or pending — rejected returns don't count. */
function liveReturnedUnits(returns: Array<{ status: ReturnStatus; quantity: number }>): number {
    return returns
        .filter((r) => !CLOSED_STATUSES.includes(r.status))
        .reduce((sum, r) => sum + r.quantity, 0);
}

function parseStatus(value: string | ReturnStatus): ReturnStatus {
    const key = String(value).toLowerCase() as ReturnStatus;
    if (!Object.values(ReturnStatus).includes(key)) {
        throw new BadRequestError(
            `Invalid return status "${value}". Expected one of: ${Object.values(ReturnStatus).join(", ")}`
        );
    }
    return key;
}
