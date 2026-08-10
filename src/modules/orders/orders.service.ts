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
import { OrderStatus, OrderType, PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";


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
    }) {
        const where: Prisma.OrderWhereInput = {};

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

    async updateOrderStatus(orderId: string, status: OrderStatus, note?: string) {
        const updated = await this.prisma.getClient().$transaction(async (tx) => {
            const existing = await tx.order.findUnique({
                where: { id: orderId },
                include: { items: { select: { variantId: true, quantity: true } } },
            });

            if (!existing) throw new NotFoundError("Order not found");

            // Cancelling puts the units back on the shelf. `returned` deliberately
            // does not — a returned garment may not be resellable, so restocking
            // it stays an explicit inventory decision.
            if (status === OrderStatus.cancelled && existing.status !== OrderStatus.cancelled) {
                for (const item of existing.items) {
                    await tx.productVariant.update({
                        where: { id: item.variantId },
                        data: { stockQty: { increment: item.quantity } },
                    });
                }

                if (existing.items.length) {
                    await tx.inventoryLog.createMany({
                        data: existing.items.map((item) => ({
                            variantId: item.variantId,
                            changeQty: item.quantity,
                            reason: "order_cancelled",
                            referenceId: orderId,
                        })),
                    });
                }
            }

            return await tx.order.update({
                where: { id: orderId },
                data: {
                    status,
                    statusLogs: {
                        create: {
                            status: status,
                            note: note,
                        } as any,
                    },
                },
            });
        });

        // Notify the customer about the status change (fire-and-forget).
        await this.notificationService.notifyOrderStatusChange({
            userId: updated.userId,
            orderId: updated.id,
            orderCode: updated.orderCode,
            status,
            itemDetails: updated.itemDetails,
        });

        return updated;
    }

    async adminUpdatePaymentStatus(orderId: string, status: string) {
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

        return await this.prisma.getClient().payment.update({
            where: { id: payment.id },
            data: {
                status: finalStatus as PaymentStatus,
            },
        });
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

        // Map the partner status name onto our enum. Unknown names keep the
        // current status rather than guessing — see roadrush-status.ts.
        const mapped = mapRoadRushStatus(statusName);
        if (!mapped) {
            logger.warn("Unrecognised RoadRush status name — keeping current order status", {
                orderId,
                statusName,
            });
        }
        const ourStatus: OrderStatus = mapped ? mapped.status : order.status;

        // Update order, mirror the logistics/COD figures, and set sync time.
        // NOTE: payment status is deliberately left untouched. `cod: true` only
        // tells the rider to collect cash — RoadRush exposes the amount due
        // (Cash_Collect) but no "collected" flag — so COD reconciliation stays
        // a manual admin action.
        const updated = await this.prisma.getClient().order.update({
            where: { id: orderId },
            data: {
                status: ourStatus,
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
            },
        });

        // Mirror the partner's status history into our own timeline.
        await this.syncStatusHistory(orderId, rrOrder.status_details);

        // Only notify the customer when the status genuinely changed.
        if (ourStatus !== order.status) {
            await this.notificationService.notifyOrderStatusChange({
                userId: updated.userId,
                orderId: updated.id,
                orderCode: updated.orderCode,
                status: ourStatus,
                itemDetails: updated.itemDetails,
            });
        }

        return updated;
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
                    createdAt,
                },
            ];
        });

        if (rows.length) {
            await this.prisma.getClient().orderStatusLog.createMany({ data: rows });
        }
    }
}
