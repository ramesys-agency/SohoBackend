import { PrismaService } from "../../core/services/index.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../../core/errors/http-errors.js";
import { NotificationService } from "../notification/notification.service.js";
import { logger } from "../../config/logger.js";
import { PaymentStatus, Prisma, ReturnStatus } from "@prisma/client";
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

/**
 * Payment states that mean the customer's money actually reached us. Only these
 * can be refunded — stamping "refunded" on an order nobody ever collected for
 * records a payment going back out that never came in.
 */
const COLLECTED_PAYMENT_STATUSES: PaymentStatus[] = [
    PaymentStatus.success,
    PaymentStatus.cod_collected,
];

/** Money is rounded to paisa at the point it is written, never before. */
const CURRENCY_DP = 2;

const round = (value: Prisma.Decimal): Prisma.Decimal =>
    value.toDecimalPlaces(CURRENCY_DP, Prisma.Decimal.ROUND_HALF_UP);

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

        // Nothing can come back before it has gone out. `returned` is allowed too
        // so further lines can be recorded against an order already flipped by an
        // earlier, partial return.
        if (order.status !== "delivered" && order.status !== "returned") {
            throw new BadRequestError(
                `Only a delivered order can be returned — this one is ${order.status}`
            );
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
     * Reaching `refunded` is the only place this service moves money, so the
     * amount is settled by `issueRefund` — see there for what a return is worth
     * and what stops an order being refunded past what was paid for it.
     */
    async adminUpdateReturnStatus(returnId: string, dto: AdminUpdateReturnDto, actorId?: string) {
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

        const order = existing.orderItem.order;

        const { updated, refundAmount } = await this.prisma.getClient().$transaction(async (tx) => {
            let issued: Prisma.Decimal | null = null;

            // Settled before the return is written so a refund that would take
            // the order past what the customer paid takes the status change down
            // with it, rather than leaving a `refunded` return with no money
            // behind it.
            if (next === ReturnStatus.refunded) {
                issued = await this.issueRefund(tx, {
                    returnId,
                    orderId: order.id,
                    quantity: existing.quantity,
                    priceAtBuy: existing.orderItem.priceAtBuy,
                    provided: dto.refundAmount,
                    ...(actorId ? { issuedBy: actorId } : {}),
                    ...(note ? { note } : {}),
                });
                data.refundAmount = issued;
            }

            return {
                updated: await tx.return.update({
                    where: { id: returnId },
                    data,
                    include: RETURN_INCLUDE,
                }),
                refundAmount: issued,
            };
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

    /**
     * Pays a return back, writes it to the ledger, and settles the payment when
     * the goods have all been refunded.
     *
     * Two things decide the amount, and both used to be missing:
     *
     * The default is what the customer actually paid for those units, not their
     * list price. An order-level discount is spread across the lines in
     * proportion to their value, so a ৳500-off order no longer refunds every
     * line at full price and hands back more than came in.
     *
     * The cap is what is left refundable on the order — its total less
     * everything already paid back. An admin can still type a different figure
     * (to include the delivery charge, say, or to refund a goodwill amount), but
     * not one that takes the order past what was collected for it.
     *
     * The delivery fee is not refunded by default: the parcel was delivered, so
     * the customer is refunded for goods and keeps paying for the trip. Adding
     * it stays a deliberate, typed-in decision.
     */
    private async issueRefund(
        tx: Prisma.TransactionClient,
        params: {
            returnId: string;
            orderId: string;
            quantity: number;
            priceAtBuy: Prisma.Decimal;
            provided?: number | string | undefined;
            issuedBy?: string;
            note?: string;
        }
    ): Promise<Prisma.Decimal> {
        const order = await tx.order.findUnique({
            where: { id: params.orderId },
            select: {
                totalAmount: true,
                shippingFee: true,
                discountAmount: true,
                items: { select: { priceAtBuy: true, quantity: true } },
            },
        });

        if (!order) throw new NotFoundError("Order not found");

        const amount = this.resolveRefundAmount(order, params);

        const alreadyRefunded = await this.sumRefunded(tx, params.orderId);
        const refundable = new Prisma.Decimal(order.totalAmount).minus(alreadyRefunded);

        if (refundable.lte(0)) {
            throw new BadRequestError("This order has already been refunded in full");
        }

        if (amount.gt(refundable)) {
            throw new BadRequestError(
                `Only ৳${refundable.toFixed(CURRENCY_DP)} is still refundable on this order — ` +
                    `৳${alreadyRefunded.toFixed(CURRENCY_DP)} of ৳${new Prisma.Decimal(order.totalAmount).toFixed(CURRENCY_DP)} has already been paid back`
            );
        }

        // The unique constraint on returnId is what makes a double refund
        // impossible, rather than a check that two requests could both pass.
        await tx.refund.create({
            data: {
                orderId: params.orderId,
                returnId: params.returnId,
                amount,
                ...(params.issuedBy && { issuedBy: params.issuedBy }),
                ...(params.note && { note: params.note }),
            },
        });

        await this.settlePaymentIfFullyRefunded(tx, {
            orderId: params.orderId,
            refundedTotal: alreadyRefunded.add(amount),
            // What the goods themselves were charged at. Comparing against the
            // order total instead would mean a fully returned order never looked
            // fully refunded, because the delivery fee is in the total but not in
            // any line refund.
            goodsValue: new Prisma.Decimal(order.totalAmount).minus(order.shippingFee),
        });

        return amount;
    }

    /** What this return is worth, before the order-level cap is applied. */
    private resolveRefundAmount(
        order: {
            discountAmount: Prisma.Decimal;
            items: Array<{ priceAtBuy: Prisma.Decimal; quantity: number }>;
        },
        params: { quantity: number; priceAtBuy: Prisma.Decimal; provided?: number | string | undefined }
    ): Prisma.Decimal {
        const { provided } = params;

        if (provided !== undefined && provided !== null && provided !== "") {
            let amount: Prisma.Decimal;
            try {
                amount = new Prisma.Decimal(provided);
            } catch {
                throw new BadRequestError("Refund amount must be a number");
            }

            if (!amount.isFinite() || amount.isNegative()) {
                throw new BadRequestError("Refund amount must be a positive number");
            }

            return round(amount);
        }

        const lineValue = new Prisma.Decimal(params.priceAtBuy).mul(params.quantity);
        const subtotal = order.items.reduce(
            (sum, item) => sum.add(new Prisma.Decimal(item.priceAtBuy).mul(item.quantity)),
            new Prisma.Decimal(0)
        );

        // No discount to spread (or nothing to spread it over) — the line is
        // worth what it was billed at.
        if (subtotal.lte(0) || order.discountAmount.lte(0)) {
            return round(lineValue);
        }

        // This line's share of the discount, in proportion to its value.
        const share = new Prisma.Decimal(order.discountAmount).mul(lineValue).div(subtotal);

        return round(lineValue.minus(share));
    }

    /**
     * Mark the payment refunded once every taka of goods is back with the
     * customer. Only a payment that was actually collected can be refunded —
     * an order the rider never collected on has nothing to send back, and
     * stamping it "refunded" would invent a payment that never happened.
     */
    private async settlePaymentIfFullyRefunded(
        tx: Prisma.TransactionClient,
        params: { orderId: string; refundedTotal: Prisma.Decimal; goodsValue: Prisma.Decimal }
    ): Promise<void> {
        if (params.refundedTotal.lt(params.goodsValue)) return;

        const payment = await tx.payment.findFirst({
            where: { orderId: params.orderId },
            orderBy: { createdAt: "desc" },
        });

        if (!payment || payment.status === PaymentStatus.refunded) return;

        if (!COLLECTED_PAYMENT_STATUSES.includes(payment.status)) {
            logger.warn("Order fully refunded but its payment was never collected", {
                orderId: params.orderId,
                paymentStatus: payment.status,
            });
            return;
        }

        await tx.payment.update({
            where: { id: payment.id },
            data: { status: PaymentStatus.refunded },
        });
    }

    /** Total already paid back on an order, straight from the ledger. */
    private async sumRefunded(
        tx: Prisma.TransactionClient,
        orderId: string
    ): Promise<Prisma.Decimal> {
        const { _sum } = await tx.refund.aggregate({
            where: { orderId },
            _sum: { amount: true },
        });

        return new Prisma.Decimal(_sum.amount ?? 0);
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
