import { PrismaService } from "../../core/services/index.js";
import {
    NotFoundError,
    ForbiddenError,
    BadRequestError,
    ConflictError,
} from "../../core/errors/http-errors.js";
import { RoadRushService, type RoadRushStatusDetail } from "../logistics/roadrush.service.js";
import { mapRoadRushStatus } from "../logistics/roadrush-status.js";
import { CouponService } from "../coupon/coupon.service.js";
import { CheckoutService, type CheckoutLine } from "../checkout/checkout.service.js";
import { logisticsJobService } from "../logistics/logistics-job.service.js";
import { logisticsJobWorker } from "../logistics/logistics-job.worker.js";
import { NotificationService } from "../notification/notification.service.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { OrderStatus, OrderType, PaymentStatus, StatusSource, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { resolveOrderStatus, type StatusOutcome } from "./order-status.resolver.js";

/**
 * Manual shipping is an internal fulfilment route — staff arrange the delivery
 * themselves. To the customer the order is simply placed and being processed,
 * so none of these fields (least of all the courier's error text) belong in a
 * customer-facing response.
 */
const MANUAL_SHIPPING_FIELDS = {
    orderType: true,
    manualReason: true,
    manualFlaggedAt: true,
    manualHandledAt: true,
    manualHandledBy: true,
} as const;

/**
 * The only status moves an admin may make, keyed by the order's current status.
 *
 * The ladder is deliberately one-way: an order is confirmed, shipped, then
 * delivered. It can be cancelled at any point before it lands — a parcel the
 * courier loses or brings back still needs a way out. Once it is delivered the
 * customer has the goods, so the only way out is a return.
 *
 * This governs what a human may ask for. What the order actually ends up at is
 * then arbitrated against RoadRush's opinion by `resolveOrderStatus` — the
 * courier is bound by its own, looser rules, not by this map.
 */
export const ADMIN_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
    [OrderStatus.pending]: [OrderStatus.processing, OrderStatus.cancelled],
    [OrderStatus.processing]: [OrderStatus.shipped, OrderStatus.cancelled],
    [OrderStatus.shipped]: [OrderStatus.delivered, OrderStatus.cancelled],
    [OrderStatus.delivered]: [OrderStatus.returned],
    [OrderStatus.cancelled]: [],
    [OrderStatus.returned]: [],
};

/**
 * Order statuses a given payment status can be set from, by hand, in the
 * dashboard.
 *
 * Money follows the goods: nothing is collectable until the parcel is in the
 * customer's hands (delivered implies paid), and a refund only makes sense once
 * the order has come back to us or never went out at all.
 *
 * `pending` / `cod_pending` are absent on purpose — those are the states an
 * order is born in, not something an admin moves it back to.
 */
const PAYMENT_STATUS_PRECONDITIONS: Partial<Record<PaymentStatus, OrderStatus[]>> = {
    [PaymentStatus.success]: [OrderStatus.delivered, OrderStatus.returned],
    [PaymentStatus.cod_collected]: [OrderStatus.delivered, OrderStatus.returned],
    [PaymentStatus.failed]: [OrderStatus.delivered, OrderStatus.returned],
    [PaymentStatus.refunded]: [OrderStatus.returned, OrderStatus.cancelled],
};

/** Payment states that mean the money is already in — nothing left to collect. */
const SETTLED_PAYMENT_STATUSES: PaymentStatus[] = [
    PaymentStatus.success,
    PaymentStatus.cod_collected,
    PaymentStatus.refunded,
];

/** Statuses that mean the parcel reached the customer, so the money is settled. */
const LANDED_STATUSES: OrderStatus[] = [OrderStatus.delivered, OrderStatus.returned];

/**
 * Statuses where the order is still on its way, so nothing is collectable yet.
 *
 * Only a move back to one of these can un-settle a payment. Cancelling a
 * delivered order is not a way back — the money did change hands, so it needs a
 * refund, not a payment reset that would erase the record of it.
 */
const PRE_DELIVERY_STATUSES: OrderStatus[] = [
    OrderStatus.pending,
    OrderStatus.processing,
    OrderStatus.shipped,
];

export interface UpdateOrderStatusOptions {
    /**
     * Skip the transition ladder. This is the dashboard's "edit status" override,
     * for correcting a status an admin set by mistake — the ladder is the rule,
     * this is the way back out of it.
     *
     * It also pins the status: an override is a human taking ownership, so the
     * courier stops being allowed to move it afterwards.
     */
    override?: boolean;
    /**
     * Put the payment back to unpaid. Only acted on when the move takes an order
     * back out of delivered/returned, where the delivery had settled it.
     */
    resetPayment?: boolean;
    /** Admin user id, recorded on the order and the timeline entry. */
    actorId?: string;
}

/**
 * One side's statement about where an order is, handed to `applyOrderStatus`.
 *
 * Every status write in this service goes through that one function so the
 * consequences of reaching a status — stock moved, payment settled, timeline
 * written, customer told — happen exactly once and identically no matter who
 * got there first. They used to live only on the admin path, which is why a
 * courier-driven cancellation never put its units back on the shelf.
 */
interface StatusIntent {
    /** Who is speaking. */
    source: StatusSource;
    /** The admin's new opinion. Omit on the courier path. */
    adminStatus?: OrderStatus;
    /** RoadRush's new opinion. Omit on the admin path. */
    logisticsStatus?: OrderStatus;
    note?: string | null;
    actorId?: string | null;
    /** Admin override — allowed to walk the status backwards. */
    force?: boolean;
    /** Pin the status against the courier, or release an existing pin. */
    pin?: boolean;
    resetPayment?: boolean;
    /** Mark the conflict as looked at. Cleared again by any new courier status. */
    acknowledge?: boolean;
    /**
     * Leave the timeline alone. Set by the poller, whose entries come from
     * `syncStatusHistory` with RoadRush's own names and timestamps — a second
     * entry for the same event would just double the timeline.
     */
    skipLog?: boolean;
    /** Extra columns the caller wants written in the same transaction. */
    extraData?: Prisma.OrderUpdateInput;
}

export class OrderService {
    private prisma: PrismaService = prisma;
    private roadRush: RoadRushService = new RoadRushService();
    private couponService: CouponService = new CouponService();
    private checkoutService: CheckoutService = new CheckoutService();
    private logisticsJobs = logisticsJobService;
    private notificationService: NotificationService = new NotificationService();

    async getAllOrders(userId: string) {
        return await this.prisma.getClient().order.findMany({
            where: { userId },
            omit: MANUAL_SHIPPING_FIELDS,
            include: {
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                        // Lets the app flag "return in progress" on the order card
                        // without a second request per order.
                        returns: {
                            orderBy: { createdAt: "desc" },
                        },
                    },
                },
                address: true,
                // Status only — enough for the app to show "Refunded" on the card
                // without handing the customer the rest of the payment record.
                payments: { select: { status: true } },
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async getOrderById(userId: string, orderId: string, userRole?: string) {
        const isAdminRequest = userRole === "admin";

        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            // Attempt counts, the fulfilment route and the partner's error text
            // are operational detail — staff need them, customers don't.
            ...(!isAdminRequest && { omit: MANUAL_SHIPPING_FIELDS }),
            include: {
                ...(isAdminRequest && { logisticsJob: true }),
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                        returns: {
                            orderBy: { createdAt: "desc" },
                        },
                    },
                },
                address: true,
                payments: true,
                statusLogs: {
                    // Internal entries explain fulfilment problems to staff; the
                    // customer's timeline stays about their order's progress.
                    ...(!isAdminRequest && { where: { internal: false } }),
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        if (order.userId !== userId && !isAdminRequest) {
            throw new ForbiddenError("You are not authorized to view this order");
        }

        return order;
    }

    async createOrder(userId: string, data: any) {
        // 1. Get order items — either from buyNow payload or the user's cart
        let cartItems: any[];

        if (data.buyNow?.variantId) {
            const variant = await this.prisma.getClient().productVariant.findUnique({
                where: { id: data.buyNow.variantId },
                include: { product: true },
            });
            if (!variant) throw new BadRequestError("Product variant not found");
            cartItems = [
                {
                    variantId: variant.id,
                    quantity: data.buyNow.quantity || 1,
                    variant,
                },
            ];
        } else {
            cartItems = await this.prisma.getClient().cartItem.findMany({
                where: { userId },
                include: {
                    variant: {
                        include: { product: true },
                    },
                },
            });
            if (cartItems.length === 0) {
                throw new BadRequestError("Cannot place order with an empty cart");
            }
        }

        // 2. Fetch Drop Address. Scoped to the buyer: an unscoped lookup lets
        // anyone who guesses an address id ship to it, and pulls that person's
        // name, phone and email into the order and the courier payload.
        const address = await this.prisma.getClient().address.findFirst({
            where: { id: data.addressId, userId, isDeleted: false },
            include: { user: true },
        });
        if (!address) throw new NotFoundError("Drop address not found");

        // 3. Compute Totals
        let subtotal = 0;
        const itemDetails = cartItems
            .map(
                (i) =>
                    `${i.variant.product.name} (${i.variant.size || ""} ${i.variant.colorName || ""}) x${
                        i.quantity
                    }`
            )
            .join(", ");

        cartItems.forEach((item) => {
            subtotal += Number(item.variant.basePrice) * item.quantity;
        });

        // 3.5. Handle Coupon
        let discountAmount = 0;
        let couponId = null;
        if (data.couponCode) {
            try {
                const couponResult = await this.couponService.validateCoupon(
                    data.couponCode,
                    userId,
                    cartItems
                );
                discountAmount = couponResult.discountAmount;
                couponId = couponResult.couponId;
            } catch (error) {
                logger.warn("Invalid coupon provided during order creation", {
                    code: data.couponCode,
                    userId,
                });
                throw error;
            }
        }

        // The delivery charge is the server's number, not the client's — the app
        // only displays what GET /checkout/config told it. Everything downstream
        // (the payment row, and the COD amount the courier collects) uses this
        // total, so what the customer agreed to is what gets collected.
        const shippingFee = config.checkout.deliveryFee;
        const totalAmount = Math.max(0, subtotal + shippingFee - discountAmount);
        const customerFullName = address.user.fullName || data.customerFullName || "Not Provided";
        const customerPhone = address.user.phone || data.customerPhone;

        if (!customerPhone || customerPhone.trim() === "" || customerPhone === "Not Provided") {
            throw new BadRequestError("Customer phone number is required to place an order");
        }

        // The lines this order consumes, keyed by variant — used for the stock
        // decrement and for matching against the checkout hold.
        const orderLines: CheckoutLine[] = cartItems.map((item) => ({
            variantId: item.variantId,
            quantity: item.quantity,
        }));

        // 4. Create Order & Payment in a transaction
        const order = await this.prisma.getClient().$transaction(async (tx) => {
            // Create Order record
            const newOrder = await tx.order.create({
                data: {
                    userId,
                    addressId: data.addressId,
                    totalAmount,
                    couponId,
                    discountAmount,
                    shippingFee,
                    aggregator: data.aggregator,
                    cod: data.paymentMethod === "COD",
                    itemValue: totalAmount,
                    itemDetails,
                    receiverDivision: address.division,
                    receiverDistrict: address.district,
                    receiverThana: address.thana,
                    dropAddress: address.dropAddress || address.street,
                    customerMobileNumber: customerPhone,
                    customerFullName: customerFullName,
                    customerEmail: address.user.email || data.customerEmail || "Not Provided",

                    items: {
                        create: cartItems.map((item) => ({
                            productId: item.variant.productId,
                            variantId: item.variantId,
                            quantity: item.quantity,
                            priceAtBuy: item.variant.basePrice,
                        })),
                    },
                },
            });

            // Turn the checkout hold into real stock movement. Everything below
            // is inside the same transaction as the order, so a customer can
            // never end up with an order that didn't consume inventory (or the
            // other way round).
            if (data.checkoutId) {
                await this.checkoutService.consumeForOrder(tx, {
                    checkoutId: data.checkoutId,
                    userId,
                    lines: orderLines,
                    orderId: newOrder.id,
                });
            }

            await this.decrementStock(tx, orderLines, newOrder.id, data.checkoutId);

            // If coupon used, increment usage
            if (couponId) {
                await this.couponService.incrementUsage(tx, couponId);
            }

            // Create Initial Payment Record
            await tx.payment.create({
                data: {
                    orderId: newOrder.id,
                    amount: totalAmount,
                    currency: "BDT",
                    provider: data.paymentMethod,
                    providerPaymentId: `COD-${newOrder.id}-${Date.now()}`,
                    status: data.paymentMethod === "COD" ? "cod_pending" : "pending",
                },
            });

            // Queue the RoadRush hand-off. Writing the job in the same
            // transaction means an order can never exist without one, so a
            // partner outage can delay a delivery but never lose it.
            await this.logisticsJobs.enqueue(tx, newOrder.id, {
                ...(data.aggregator && { aggregator: data.aggregator }),
                receiver_division: address.division,
                receiver_district: address.district,
                receiver_thana: address.thana,
                drop_address: address.dropAddress || address.street,
                customer_full_name: customerFullName,
                customer_mobile_number: customerPhone,
                item_value: totalAmount,
                cod: data.paymentMethod === "COD",
                item_details: itemDetails,
            });

            // Clear the User's Cart (skip for buy-now orders — cart is untouched)
            if (!data.buyNow?.variantId) {
                await tx.cartItem.deleteMany({ where: { userId } });
            }

            return newOrder;
        });

        // 4.5. Notify the customer their order was placed.
        await this.notificationService.notifyOrderStatusChange({
            userId,
            orderId: order.id,
            orderCode: order.orderCode,
            status: order.status,
            itemDetails: order.itemDetails,
        });

        // 5. Kick the queue so the happy path still syncs in milliseconds. Not
        //    awaited: the customer's response must not wait on RoadRush, and a
        //    failure here only means the job runs on the next worker tick.
        void logisticsJobWorker.runOnce().catch((error) => {
            logger.warn("Immediate logistics sync attempt failed to run", {
                orderId: order.id,
                error: error instanceof Error ? error.message : String(error),
            });
        });

        // Same reasoning as the other customer-facing reads: the fulfilment
        // route is not the customer's business.
        const {
            orderType: _orderType,
            manualReason: _manualReason,
            manualFlaggedAt: _manualFlaggedAt,
            manualHandledAt: _manualHandledAt,
            manualHandledBy: _manualHandledBy,
            ...customerFacingOrder
        } = order;

        return customerFacingOrder;
    }

    /**
     * Take the ordered units out of stock, atomically.
     *
     * The conditional `stockQty >= quantity` on the update is the last line of
     * defence: even if every check above it were bypassed, two concurrent orders
     * for the last unit cannot both succeed. Holds belonging to other shoppers
     * are subtracted too, so an order can't jump the queue on someone who is
     * mid-checkout.
     */
    private async decrementStock(
        tx: Prisma.TransactionClient,
        lines: CheckoutLine[],
        orderId: string,
        checkoutId?: string
    ): Promise<void> {
        const variantIds = [...new Set(lines.map((line) => line.variantId))];

        const reserved = await this.checkoutService.getReservedQuantities(tx, variantIds, {
            excludeCheckoutId: checkoutId,
        });

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

        for (const line of lines) {
            const variant = variants.find((v) => v.id === line.variantId);
            if (!variant) throw new NotFoundError("Product variant not found");

            const available = variant.stockQty - (reserved.get(line.variantId) ?? 0);
            if (available < line.quantity) {
                throw new ConflictError(
                    `Not enough stock for ${variant.product.name}${
                        variant.size ? ` (${variant.size})` : ""
                    }`,
                    {
                        items: [
                            {
                                variantId: line.variantId,
                                productName: variant.product.name,
                                variantLabel: [variant.size, variant.colorName]
                                    .filter(Boolean)
                                    .join(" / "),
                                requested: line.quantity,
                                available: Math.max(0, available),
                            },
                        ],
                    }
                );
            }
        }

        for (const line of lines) {
            const { count } = await tx.productVariant.updateMany({
                where: { id: line.variantId, stockQty: { gte: line.quantity } },
                data: { stockQty: { decrement: line.quantity } },
            });

            if (count !== 1) {
                throw new ConflictError(
                    "One of your items just sold out — please review your cart"
                );
            }
        }

        await tx.inventoryLog.createMany({
            data: lines.map((line) => ({
                variantId: line.variantId,
                changeQty: -line.quantity,
                reason: "order",
                referenceId: orderId,
            })),
        });
    }

    async adminGetAllOrders(params?: {
        search?: string;
        startDate?: string;
        endDate?: string;
        paymentStatus?: string;
        fulfillmentStatus?: string;
        orderType?: string;
        /** "true" narrows the list to orders whose two statuses disagree. */
        statusConflict?: string;
    }) {
        const where: Prisma.OrderWhereInput = {};

        if (params?.statusConflict === "true") {
            where.statusConflict = true;
            where.statusConflictAckAt = null;
        }

        if (params?.orderType && params.orderType !== "all") {
            const orderType = Object.values(OrderType).find((t) => t === params.orderType);
            if (!orderType) {
                throw new BadRequestError(
                    `Invalid order type "${params.orderType}". Expected one of: ${Object.values(OrderType).join(", ")}`
                );
            }
            where.orderType = orderType;
        }

        if (params?.search?.trim()) {
            const q = params.search.trim();
            where.OR = [
                { orderCode: { contains: q, mode: "insensitive" } },
                { id: { contains: q, mode: "insensitive" } },
                { customerFullName: { contains: q, mode: "insensitive" } },
                { customerEmail: { contains: q, mode: "insensitive" } },
                { customerMobileNumber: { contains: q, mode: "insensitive" } },
                { user: { fullName: { contains: q, mode: "insensitive" } } },
                { user: { email: { contains: q, mode: "insensitive" } } },
                { user: { phone: { contains: q, mode: "insensitive" } } },
            ];
        }

        if (params?.startDate || params?.endDate) {
            where.createdAt = {};
            if (params.startDate) {
                (where.createdAt as Prisma.DateTimeFilter).gte = new Date(params.startDate);
            }
            if (params.endDate) {
                // Include the full end day
                const end = new Date(params.endDate);
                end.setHours(23, 59, 59, 999);
                (where.createdAt as Prisma.DateTimeFilter).lte = end;
            }
        }

        if (params?.paymentStatus && params.paymentStatus !== "all") {
            const statusMap: Record<string, string[]> = {
                paid: ["success", "paid"],
                pending: ["pending", "cod_pending"],
                refunded: ["refunded"],
            };
            const statuses = statusMap[params.paymentStatus.toLowerCase()];
            if (statuses) {
                where.payments = { some: { status: { in: statuses as PaymentStatus[] } } };
            }
        }

        if (params?.fulfillmentStatus && params.fulfillmentStatus !== "all") {
            const statusMap: Record<string, OrderStatus | OrderStatus[]> = {
                fulfilled: "delivered" as OrderStatus,
                unfulfilled: ["pending", "cancelled", "returned"] as OrderStatus[],
                processing: ["processing", "shipped"] as OrderStatus[],
                returned: "returned" as OrderStatus,
            };
            const mapped = statusMap[params.fulfillmentStatus.toLowerCase()];
            if (mapped) {
                where.status = Array.isArray(mapped) ? { in: mapped } : mapped;
            }
        }

        return await this.prisma.getClient().order.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                        email: true,
                        phone: true,
                    },
                },
                items: {
                    include: {
                        product: true,
                        variant: true,
                        returns: {
                            orderBy: { createdAt: "desc" },
                        },
                    },
                },
                address: true,
                payments: true,
                statusLogs: true,
                logisticsJob: true,
            },
            orderBy: { createdAt: "desc" },
        });
    }

    /**
     * Orders the automated hand-off gave up on. `handled=false` (the default) is
     * the work queue staff act on; `true` is the history of what they already
     * arranged.
     */
    async adminGetManualOrders(params?: { handled?: string; search?: string }) {
        const where: Prisma.OrderWhereInput = { orderType: OrderType.manual_shipping };

        const handled = (params?.handled ?? "false").toLowerCase();
        if (handled === "false") {
            where.manualHandledAt = null;
        } else if (handled === "true") {
            where.manualHandledAt = { not: null };
        }

        if (params?.search?.trim()) {
            const q = params.search.trim();
            where.OR = [
                { orderCode: { contains: q, mode: "insensitive" } },
                { id: { contains: q, mode: "insensitive" } },
                { customerFullName: { contains: q, mode: "insensitive" } },
                { customerMobileNumber: { contains: q, mode: "insensitive" } },
            ];
        }

        return await this.prisma.getClient().order.findMany({
            where,
            include: {
                user: { select: { id: true, fullName: true, email: true, phone: true } },
                items: { include: { product: true, variant: true } },
                address: true,
                payments: true,
                logisticsJob: true,
            },
            orderBy: { manualFlaggedAt: "desc" },
        });
    }

    /** Badge count for the dashboard — deliberately just a count. */
    async adminGetManualCount(): Promise<{ pending: number }> {
        const pending = await this.prisma.getClient().order.count({
            where: { orderType: OrderType.manual_shipping, manualHandledAt: null },
        });

        return { pending };
    }

    /** Staff arranged the delivery themselves. Keeps the record, clears the queue. */
    async adminSetManualHandled(orderId: string, adminId: string, handled: boolean) {
        const order = await this.prisma.getClient().order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundError("Order not found");

        if (order.orderType !== OrderType.manual_shipping) {
            throw new BadRequestError("This order is not marked for manual shipping");
        }

        return await this.prisma.getClient().order.update({
            where: { id: orderId },
            data: handled
                ? { manualHandledAt: new Date(), manualHandledBy: adminId }
                : { manualHandledAt: null, manualHandledBy: null },
        });
    }

    /**
     * Put a failed order back in the queue with a fresh set of attempts and run
     * it immediately, so an admin gets an answer rather than a promise.
     */
    async adminRetrySync(orderId: string) {
        const order = await this.prisma.getClient().order.findUnique({ where: { id: orderId } });
        if (!order) throw new NotFoundError("Order not found");
        if (order.orderCode) throw new BadRequestError("Order is already synced with RoadRush");

        await this.logisticsJobs.requeue(orderId);
        const result = await logisticsJobWorker.runOnce();

        return {
            ...result,
            order: await this.prisma.getClient().order.findUnique({
                where: { id: orderId },
                include: { logisticsJob: true },
            }),
        };
    }

    /**
     * Admin-driven status change. Only the moves in ADMIN_STATUS_TRANSITIONS are
     * accepted, cancelling always carries a customer-facing reason, and reaching
     * `delivered` settles the payment (delivered means the money changed hands —
     * cash to the rider, or already paid online).
     */
    async updateOrderStatus(
        orderId: string,
        status: OrderStatus,
        note?: string,
        options?: UpdateOrderStatusOptions
    ) {
        if (!Object.values(OrderStatus).includes(status)) {
            throw new BadRequestError(
                `Invalid order status "${status}". Expected one of: ${Object.values(OrderStatus).join(", ")}`
            );
        }

        const override = options?.override === true;
        const reason = note?.trim();

        // The customer is told the order was cancelled either way, so an empty
        // reason would leave them with a cancellation and no explanation.
        if (status === OrderStatus.cancelled && !reason) {
            throw new BadRequestError(
                "A cancellation reason is required — the customer is shown it"
            );
        }

        const { order, changed, outcome } = await this.prisma
            .getClient()
            .$transaction(async (tx) => {
                const existing = await tx.order.findUnique({
                    where: { id: orderId },
                    select: { status: true },
                });

                if (!existing) throw new NotFoundError("Order not found");

                if (existing.status === status) {
                    throw new BadRequestError(`This order is already ${status}`);
                }

                // `override` is the correction path — an admin fixing a status set
                // by mistake. It skips the ladder but nothing else: the reason, the
                // stock moves and the notification all still happen.
                if (!override) {
                    const allowed = ADMIN_STATUS_TRANSITIONS[existing.status] ?? [];
                    if (!allowed.includes(status)) {
                        throw new BadRequestError(
                            allowed.length === 0
                                ? `A ${existing.status} order is final — use the status override to correct it`
                                : `A ${existing.status} order can only move to: ${allowed.join(", ")}`
                        );
                    }
                }

                return await this.applyOrderStatus(tx, orderId, {
                    source: StatusSource.admin,
                    adminStatus: status,
                    note: reason ?? null,
                    actorId: options?.actorId ?? null,
                    force: override,
                    // An override is a human taking ownership, so the courier stops
                    // being allowed to move this order from here on.
                    ...(override && { pin: true }),
                    resetPayment: options?.resetPayment === true,
                });
            });

        if (changed) {
            // Notify the customer about the status change (fire-and-forget).
            await this.notificationService.notifyOrderStatusChange({
                userId: order.userId,
                orderId: order.id,
                orderCode: order.orderCode,
                status: outcome.status,
                itemDetails: order.itemDetails,
                ...(reason ? { note: reason } : {}),
            });
        }

        return order;
    }

    /**
     * The single place an order's effective status is written.
     *
     * Both writers — the dashboard and the RoadRush poller — state their own
     * opinion here and `resolveOrderStatus` decides which one the order actually
     * takes. Everything that follows from *arriving* at a status then happens
     * once, in one transaction, regardless of who caused it: stock moves,
     * payment settles, the timeline gets an entry.
     *
     * That last part is the point. These consequences used to live only on the
     * admin path, so the same status reached by the poller left the stock and
     * the money untouched.
     *
     * Returns the updated order plus whether the effective status actually
     * moved — callers use that to decide whether the customer hears about it.
     */
    private async applyOrderStatus(
        tx: Prisma.TransactionClient,
        orderId: string,
        intent: StatusIntent
    ) {
        const existing = await tx.order.findUnique({
            where: { id: orderId },
            include: { items: { select: { variantId: true, quantity: true } } },
        });

        if (!existing) throw new NotFoundError("Order not found");

        const pinned = intent.pin ?? existing.adminStatusPinned;

        const outcome: StatusOutcome = resolveOrderStatus({
            current: existing.status,
            currentSource: existing.statusSource,
            admin: intent.adminStatus ?? existing.adminStatus,
            logistics: intent.logisticsStatus ?? existing.logisticsStatus,
            // A `manual_shipping` order is being delivered by staff, so RoadRush
            // has no standing to overrule them even if a stale code is on file.
            handedOff: existing.orderCode !== null && existing.orderType === OrderType.standard,
            pinned,
            force: intent.force === true,
            forceSource: intent.source,
        });

        const changed = outcome.status !== existing.status;

        if (changed) {
            const payment = await tx.payment.findFirst({
                where: { orderId },
                orderBy: { createdAt: "desc" },
            });

            // Delivered means the customer has the goods and has settled up, so
            // the payment stops being pending here rather than in a second,
            // forgettable admin action. `Payment not received` on the dashboard is
            // the escape hatch for the rider who came back empty-handed.
            if (outcome.status === OrderStatus.delivered) {
                if (payment && !SETTLED_PAYMENT_STATUSES.includes(payment.status)) {
                    await tx.payment.update({
                        where: { id: payment.id },
                        data: { status: PaymentStatus.success },
                    });
                }
            }

            // Undoing a delivery has to undo what the delivery implied, otherwise
            // the order sits at "processing" with the money already counted. Opt-in
            // rather than automatic: only the admin knows whether the cash actually
            // came in before the status was corrected.
            if (
                intent.resetPayment &&
                payment &&
                LANDED_STATUSES.includes(existing.status) &&
                PRE_DELIVERY_STATUSES.includes(outcome.status) &&
                payment.status !== PaymentStatus.refunded
            ) {
                await tx.payment.update({
                    where: { id: payment.id },
                    data: {
                        status:
                            payment.provider === "COD"
                                ? PaymentStatus.cod_pending
                                : PaymentStatus.pending,
                    },
                });
            }

            // Cancelling puts the units back on the shelf. `returned` deliberately
            // does not — a returned garment may not be resellable, so restocking
            // it stays an explicit inventory decision.
            if (outcome.status === OrderStatus.cancelled) {
                await this.moveStock(tx, orderId, existing.items, 1, "order_cancelled");
            }

            // ...and taking an order back out of cancelled has to take those units
            // off the shelf again, or every reverted cancellation quietly inflates
            // stock. Can push a variant negative, which is the honest answer: the
            // units were promised twice.
            if (existing.status === OrderStatus.cancelled) {
                await this.moveStock(tx, orderId, existing.items, -1, "order_cancel_reverted");
            }

            if (!intent.skipLog) {
                await tx.orderStatusLog.create({
                    data: {
                        orderId,
                        status: outcome.status,
                        note: intent.note ?? null,
                        source: intent.source,
                    },
                });
            }
        }

        const data: Prisma.OrderUpdateInput = {
            ...intent.extraData,
            status: outcome.status,
            statusSource: outcome.source,
            statusConflict: outcome.conflict,
            statusConflictReason: outcome.conflictReason,
            ...(intent.adminStatus !== undefined && {
                adminStatus: intent.adminStatus,
                adminStatusAt: new Date(),
                adminStatusBy: intent.actorId ?? null,
                adminStatusReason: intent.note ?? null,
            }),
            ...(intent.logisticsStatus !== undefined && {
                logisticsStatus: intent.logisticsStatus,
            }),
            ...(intent.pin !== undefined && { adminStatusPinned: intent.pin }),
        };

        // An acknowledgement covers the conflict that was on the table when it was
        // made. Anything new from RoadRush — or the disagreement going away —
        // clears it, so a resolved conflict can never mask the next one.
        const courierMoved =
            intent.logisticsStatus !== undefined &&
            intent.logisticsStatus !== existing.logisticsStatus;

        if (intent.acknowledge) {
            data.statusConflictAckAt = new Date();
        } else if (courierMoved || !outcome.conflict) {
            data.statusConflictAckAt = null;
        }

        const order = await tx.order.update({ where: { id: orderId }, data });

        return { order, changed, outcome };
    }

    /**
     * Move an order's units on or off the shelf and log why. `direction` is +1 to
     * put them back (a cancellation) and -1 to take them again (that cancellation
     * being undone).
     */
    private async moveStock(
        tx: Prisma.TransactionClient,
        orderId: string,
        items: Array<{ variantId: string; quantity: number }>,
        direction: 1 | -1,
        reason: string
    ): Promise<void> {
        if (!items.length) return;

        for (const item of items) {
            await tx.productVariant.update({
                where: { id: item.variantId },
                data: { stockQty: { increment: direction * item.quantity } },
            });
        }

        await tx.inventoryLog.createMany({
            data: items.map((item) => ({
                variantId: item.variantId,
                changeQty: direction * item.quantity,
                reason,
                referenceId: orderId,
            })),
        });
    }

    async adminUpdatePaymentStatus(orderId: string, status: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            select: { status: true, userId: true, orderCode: true },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        // Find existing payment for this order
        const payment = await this.prisma.getClient().payment.findFirst({
            where: { orderId },
            orderBy: { createdAt: "desc" },
        });

        if (!payment) {
            throw new NotFoundError("Payment record not found for this order");
        }

        // "completed" is what the dashboard's Confirm Payment button sends.
        const finalStatus = status === "completed" ? "success" : String(status ?? "").toLowerCase();

        // Validate against the enum before handing it to Prisma — an unknown value
        // used to surface as an opaque 500 instead of a useful 400.
        if (!Object.values(PaymentStatus).includes(finalStatus as PaymentStatus)) {
            throw new BadRequestError(
                `Invalid payment status "${status}". Expected one of: ${Object.values(PaymentStatus).join(", ")}`
            );
        }

        // Keep money in step with fulfilment — see PAYMENT_STATUS_PRECONDITIONS.
        const requires = PAYMENT_STATUS_PRECONDITIONS[finalStatus as PaymentStatus];
        if (!requires) {
            throw new BadRequestError(`Payment cannot be set back to "${finalStatus}" by hand`);
        }
        if (!requires.includes(order.status)) {
            throw new BadRequestError(
                `Payment can only be marked "${finalStatus}" on a ${requires.join(" or ")} order — this one is ${order.status}`
            );
        }

        const updated = await this.prisma.getClient().payment.update({
            where: { id: payment.id },
            data: {
                status: finalStatus as PaymentStatus,
            },
        });

        // A refund is the customer's money moving — they hear about it. Guarded on
        // an actual change so re-saving the same status doesn't notify twice.
        if (
            updated.status === PaymentStatus.refunded &&
            payment.status !== PaymentStatus.refunded
        ) {
            await this.notificationService.notifyOrderRefunded({
                userId: order.userId,
                orderId,
                orderCode: order.orderCode,
                amount: updated.amount.toString(),
            });
        }

        return updated;
    }

    async syncOrderWithRoadRush(orderId: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            include: {
                address: { include: { user: true } },
                items: { include: { product: true, variant: true } },
            },
        });

        if (!order) throw new NotFoundError("Order not found");
        if (order.orderCode) throw new BadRequestError("Order is already synced with RoadRush");

        const customerFullName = order.address.user.fullName || "Not Provided";
        const customerPhone =
            order.address.user.phone || order.customerMobileNumber || "Not Provided";

        const pickupAddressId = await this.roadRush.getPickupAddressId();

        const rrResponse = await this.roadRush.placeOrder({
            marcent_pickup_address_id: pickupAddressId,
            // Optional — omitted so RoadRush picks the aggregator internally.
            ...(order.aggregator && { aggregator: order.aggregator }),
            receiver_division: order.receiverDivision,
            receiver_district: order.receiverDistrict,
            receiver_thana: order.receiverThana,
            drop_address: order.dropAddress,
            customer_full_name: customerFullName,
            customer_mobile_number: customerPhone,
            item_value: order.totalAmount,
            cod: order.cod,
            item_details: order.itemDetails,
        });

        // RoadRush answers a successful placement with status "pending" while the
        // OPS team assigns an aggregator, so the order_code — not the status
        // string — is what tells us they took it.
        const placedOrderCode = rrResponse.order_code ?? rrResponse.order?.order_code;

        if (placedOrderCode) {
            // A hand sync makes the queued attempt pointless, and takes the
            // order back off the manual-shipping list.
            await this.logisticsJobs.cancelForOrder(order.id);

            // Also update the saved customer details from what was sent
            return await this.prisma.getClient().order.update({
                where: { id: order.id },
                data: {
                    orderCode: String(placedOrderCode),
                    merchantPickupAddressId: String(pickupAddressId),
                    customerFullName: customerFullName,
                    customerMobileNumber: customerPhone,
                    customerEmail:
                        order.address.user.email || order.customerEmail || "Not Provided",
                    orderType: OrderType.standard,
                    manualReason: null,
                    manualFlaggedAt: null,
                },
            });
        }

        throw new Error("Failed to sync with RoadRush: " + JSON.stringify(rrResponse));
    }

    async refreshOrderStatus(orderId: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
        });

        if (!order) throw new NotFoundError("Order not found");
        if (!order.orderCode)
            throw new BadRequestError("Order has not been synced with RoadRush yet");

        const rrResponse = await this.roadRush.getOrderDetails(order.orderCode);
        logger.info("RoadRush order_details response", { orderId, response: rrResponse });

        if (rrResponse.status !== "success") {
            throw new Error(
                "Failed to refresh status from RoadRush: " + JSON.stringify(rrResponse)
            );
        }

        // RoadRush might return it as .order or .order_details depending on version
        const rrOrder = rrResponse.order || rrResponse.order_details;
        const statusName = rrOrder?.status;

        if (!rrOrder || !statusName) {
            logger.warn("RoadRush refresh returned success but no status was found", {
                orderId,
                response: rrResponse,
            });
            throw new Error(
                "Failed to refresh status from RoadRush: " + JSON.stringify(rrResponse)
            );
        }

        // Map the partner status name onto our enum. Unknown names leave RoadRush's
        // recorded opinion untouched rather than guessing — see roadrush-status.ts.
        const mapped = mapRoadRushStatus(statusName);
        if (!mapped) {
            logger.warn("Unrecognised RoadRush status name — keeping current order status", {
                orderId,
                statusName,
            });
        }

        // Everything RoadRush tells us that is not the status itself. Written in
        // the same transaction as the status so a refresh is all-or-nothing.
        //
        // NOTE: payment status is deliberately absent. `cod: true` only tells the
        // rider to collect cash — RoadRush exposes the amount due (Cash_Collect)
        // but no "collected" flag — so COD reconciliation stays a manual action
        // except for the settle-on-delivered rule every path shares.
        const mirrored: Prisma.OrderUpdateInput = {
            logisticsStatusName: statusName,
            lastLogisticsSync: new Date(),

            // Logistics & COD figures reported by RoadRush
            ...(rrOrder.Cash_Collect !== undefined && {
                cashCollectAmount: rrOrder.Cash_Collect,
            }),
            ...(rrOrder.Fee !== undefined && { deliveryFee: rrOrder.Fee }),
            ...(rrOrder.COD_charge !== undefined && { codCharge: rrOrder.COD_charge }),
            ...(rrOrder.Vat !== undefined && { vat: rrOrder.Vat }),
            ...(rrOrder.Tax !== undefined && { tax: rrOrder.Tax }),
            ...(rrOrder.distance_km !== undefined && { distanceKm: rrOrder.distance_km }),
            ...(rrOrder.delivery_priority && {
                deliveryPriority: rrOrder.delivery_priority,
            }),
            ...(rrOrder.otp && { otp: rrOrder.otp }),
            ...(rrOrder.rcv_pay !== undefined && { rcvPay: rrOrder.rcv_pay }),
            ...(rrOrder.RequestDeliveryDate && {
                requestDeliveryDate: rrOrder.RequestDeliveryDate,
            }),

            // Backfill missing details from RoadRush if available
            ...(!order.customerFullName &&
                rrOrder.customer_full_name && {
                    customerFullName: rrOrder.customer_full_name,
                }),
            ...(!order.customerMobileNumber &&
                rrOrder.customer_mobile_number && {
                    customerMobileNumber: rrOrder.customer_mobile_number,
                }),
            ...(!order.customerEmail &&
                rrOrder.customer_email && { customerEmail: rrOrder.customer_email }),
        };

        const {
            order: updated,
            changed,
            outcome,
        } = await this.prisma.getClient().$transaction(async (tx) =>
            this.applyOrderStatus(tx, orderId, {
                source: StatusSource.roadrush,
                ...(mapped && { logisticsStatus: mapped.status }),
                extraData: mirrored,
                skipLog: true,
            })
        );

        // Mirror the partner's status history into our own timeline.
        await this.syncStatusHistory(orderId, rrOrder.status_details);

        // Only notify the customer when the effective status genuinely changed —
        // RoadRush walking its own statuses backwards, or an admin holding the
        // order at something else, must not turn into a stream of pings.
        if (changed) {
            await this.notificationService.notifyOrderStatusChange({
                userId: updated.userId,
                orderId: updated.id,
                orderCode: updated.orderCode,
                status: outcome.status,
                itemDetails: updated.itemDetails,
            });
        }

        return updated;
    }

    /**
     * Settle a status disagreement one way or the other.
     *
     * `accept` takes RoadRush's word for it — including the cancellations the
     * resolver refuses to apply on its own, so this is the path that restocks
     * units when a delivery really is off. `keep` pins our status instead and
     * marks the conflict as seen; it comes back if RoadRush reports something
     * new.
     */
    async adminResolveStatusConflict(
        orderId: string,
        adminId: string,
        choice: "accept" | "keep",
        note?: string
    ) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            select: { statusConflict: true, logisticsStatus: true },
        });

        if (!order) throw new NotFoundError("Order not found");
        if (!order.statusConflict) {
            throw new BadRequestError("This order's status is not in conflict");
        }

        const reason = note?.trim() || null;

        const {
            order: updated,
            changed,
            outcome,
        } = await this.prisma.getClient().$transaction(async (tx) => {
            if (choice === "keep") {
                return await this.applyOrderStatus(tx, orderId, {
                    source: StatusSource.admin,
                    actorId: adminId,
                    note: reason,
                    pin: true,
                    acknowledge: true,
                });
            }

            if (!order.logisticsStatus) {
                throw new BadRequestError("RoadRush has not reported a status for this order yet");
            }

            // Forced on RoadRush's behalf: their status becomes our stated
            // position, the pin comes off, and the consequences of landing
            // there (restock, payment) run through the same path as always.
            return await this.applyOrderStatus(tx, orderId, {
                source: StatusSource.roadrush,
                adminStatus: order.logisticsStatus,
                actorId: adminId,
                note: reason,
                force: true,
                pin: false,
            });
        });

        if (changed) {
            await this.notificationService.notifyOrderStatusChange({
                userId: updated.userId,
                orderId: updated.id,
                orderCode: updated.orderCode,
                status: outcome.status,
                itemDetails: updated.itemDetails,
                ...(reason ? { note: reason } : {}),
            });
        }

        return updated;
    }

    /**
     * Orders whose two statuses disagree and nobody has looked yet. The queue
     * staff work through, same shape as the manual-shipping one.
     */
    async adminGetStatusConflicts(params?: { search?: string }) {
        const where: Prisma.OrderWhereInput = {
            statusConflict: true,
            statusConflictAckAt: null,
        };

        if (params?.search?.trim()) {
            const q = params.search.trim();
            where.OR = [
                { orderCode: { contains: q, mode: "insensitive" } },
                { id: { contains: q, mode: "insensitive" } },
                { customerFullName: { contains: q, mode: "insensitive" } },
                { customerMobileNumber: { contains: q, mode: "insensitive" } },
            ];
        }

        return await this.prisma.getClient().order.findMany({
            where,
            include: {
                user: { select: { id: true, fullName: true, email: true, phone: true } },
                items: { include: { product: true, variant: true } },
                address: true,
                payments: true,
            },
            orderBy: { lastLogisticsSync: "desc" },
        });
    }

    /** Badge count for the dashboard — deliberately just a count. */
    async adminGetStatusConflictCount(): Promise<{ pending: number }> {
        const pending = await this.prisma.getClient().order.count({
            where: { statusConflict: true, statusConflictAckAt: null },
        });

        return { pending };
    }

    /**
     * Mirror RoadRush's `status_details` array into OrderStatusLog.
     * Entries already stored (same partner status name + timestamp) are skipped,
     * so this is safe to run on every refresh.
     */
    private async syncStatusHistory(
        orderId: string,
        statusDetails?: RoadRushStatusDetail[]
    ): Promise<void> {
        if (!statusDetails?.length) return;

        const existing = await this.prisma.getClient().orderStatusLog.findMany({
            where: { orderId, logisticsStatusName: { not: null } },
            select: { logisticsStatusName: true, createdAt: true },
        });

        const seen = new Set(
            existing.map((log) => `${log.logisticsStatusName}|${log.createdAt.toISOString()}`)
        );

        const rows = statusDetails.flatMap((detail) => {
            const mapped = mapRoadRushStatus(detail.status_name);
            if (!mapped) {
                logger.warn("Skipping unrecognised RoadRush status in history", {
                    orderId,
                    statusName: detail.status_name,
                });
                return [];
            }

            const createdAt = new Date(detail.Created_at);
            if (Number.isNaN(createdAt.getTime())) {
                logger.warn("Skipping RoadRush history entry with an invalid timestamp", {
                    orderId,
                    createdAt: detail.Created_at,
                });
                return [];
            }

            if (seen.has(`${detail.status_name}|${createdAt.toISOString()}`)) return [];
            seen.add(`${detail.status_name}|${createdAt.toISOString()}`);

            return [
                {
                    orderId,
                    status: mapped.status,
                    logisticsStatusName: detail.status_name,
                    note: detail.Description || null,
                    source: StatusSource.roadrush,
                    createdAt,
                },
            ];
        });

        if (rows.length) {
            await this.prisma.getClient().orderStatusLog.createMany({ data: rows });
        }
    }
}
