import { PrismaService } from "../../core/services/index.js";
import { NotFoundError, ForbiddenError, BadRequestError } from "../../core/errors/http-errors.js";
import { RoadRushService } from "../logistics/roadrush.service.js";
import { CouponService } from "../coupon/coupon.service.js";
import { NotificationService } from "../notification/notification.service.js";
import { logger } from "../../config/logger.js";
import { OrderStatus, PaymentStatus, type Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";


export class OrderService {
    private prisma: PrismaService = prisma;
    private roadRush: RoadRushService = new RoadRushService();
    private couponService: CouponService = new CouponService();
    private notificationService: NotificationService = new NotificationService();

    async getAllOrders(userId: string) {
        return await this.prisma.getClient().order.findMany({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                    },
                },
                address: true,
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async getOrderById(userId: string, orderId: string, userRole?: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            include: {
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                    },
                },
                address: true,
                payments: true,
                statusLogs: {
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        const isAdmin = userRole === "admin";

        if (order.userId !== userId && !isAdmin) {
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

        // 2. Fetch Drop Address
        const address = await this.prisma.getClient().address.findUnique({
            where: { id: data.addressId },
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

        const totalAmount = subtotal - discountAmount;
        const customerFullName = address.user.fullName || data.customerFullName || "Not Provided";
        const customerPhone = address.user.phone || data.customerPhone;

        if (!customerPhone || customerPhone.trim() === "" || customerPhone === "Not Provided") {
            throw new BadRequestError("Customer phone number is required to place an order");
        }

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

        // 5. Fire-and-forget RoadRush sync — do NOT await so the client gets a
        //    response immediately after the DB transaction. Cart is only cleared
        //    inside the transaction above, so if the transaction failed the cart
        //    is always preserved. The logistics sync happens in the background.
        this.roadRush.placeOrder({
            marcent_pickup_address_id: 17,
            aggregator: data.aggregator || "pathao",
            receiver_division: address.division,
            receiver_district: address.district,
            receiver_thana: address.thana,
            drop_address: address.dropAddress || address.street,
            customer_full_name: customerFullName,
            customer_mobile_number: customerPhone,
            item_value: totalAmount,
            cod: data.paymentMethod === "COD",
            item_details: itemDetails,
        }).then(async (rrResponse) => {
            if (rrResponse.status === "success" && rrResponse.order_code) {
                await this.prisma.getClient().order.update({
                    where: { id: order.id },
                    data: { orderCode: rrResponse.order_code },
                });
            } else if (rrResponse.status === "success") {
                logger.warn("RoadRush order placed but order_code was missing in response", {
                    orderId: order.id,
                    response: rrResponse,
                });
            }
        }).catch((error) => {
            logger.error("Failed to sync order with RoadRush logistics", {
                orderId: order.id,
                error: error instanceof Error ? error.message : String(error),
            });
        });

        return order;
    }

    async adminGetAllOrders(params?: {
        search?: string;
        startDate?: string;
        endDate?: string;
        paymentStatus?: string;
        fulfillmentStatus?: string;
    }) {
        const where: Prisma.OrderWhereInput = {};

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
                unfulfilled: ["pending", "cancelled"] as OrderStatus[],
                processing: ["processing", "shipped"] as OrderStatus[],
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
                    },
                },
                address: true,
                payments: true,
                statusLogs: true,
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async updateOrderStatus(orderId: string, status: OrderStatus, note?: string) {
        const updated = await this.prisma.getClient().order.update({
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

        const finalStatus = status === "completed" ? "success" : status;

        return await this.prisma.getClient().payment.update({
            where: { id: payment.id },
            data: {
                status: finalStatus as any,
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

        const rrResponse = await this.roadRush.placeOrder({
            marcent_pickup_address_id: 17,
            aggregator: order.aggregator || "pathao",
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

        if (rrResponse.status === "success" && rrResponse.order_code) {
            // Also update the saved customer details from what was sent
            return await this.prisma.getClient().order.update({
                where: { id: order.id },
                data: {
                    orderCode: rrResponse.order_code,
                    customerFullName: customerFullName,
                    customerMobileNumber: customerPhone,
                    customerEmail:
                        order.address.user.email || order.customerEmail || "Not Provided",
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
        console.log(
            "REFRESH_ORDER_STATUS: Raw RoadRush response:",
            JSON.stringify(rrResponse, null, 2)
        );
        logger.info("RoadRush order_details response", { orderId, response: rrResponse });

        if (rrResponse.status === "success") {
            // RoadRush might return it as .order or .order_details depending on version
            const rrOrder = (rrResponse as any).order || (rrResponse as any).order_details;

            // The field name is actually 'status' in the response log, not 'order_status'
            const newStatus = rrOrder?.status || rrOrder?.order_status;

            if (newStatus) {
                // Map RoadRush status to our OrderStatus enum
                // RoadRush: Order Place, Processing, Shipped, Delivered, Cancelled
                let ourStatus: any = order.status;
                const normalizedStatus = newStatus.toLowerCase();

                if (normalizedStatus.includes("place")) ourStatus = "pending";
                else if (normalizedStatus.includes("processing")) ourStatus = "processing";
                else if (normalizedStatus.includes("shipped")) ourStatus = "shipped";
                else if (normalizedStatus.includes("picked")) ourStatus = "shipped";
                else if (normalizedStatus.includes("delivered")) ourStatus = "delivered";
                else if (normalizedStatus.includes("cancelled")) ourStatus = "cancelled";
                else if (normalizedStatus.includes("failed")) ourStatus = "cancelled";

                // Update order and set sync time
                const updated = await this.prisma.getClient().order.update({
                    where: { id: orderId },
                    data: {
                        status: ourStatus,
                        lastLogisticsSync: new Date(),
                        // Backfill missing details from RoadRush if available
                        customerFullName: order.customerFullName || rrOrder?.customer_full_name,
                        customerMobileNumber:
                            order.customerMobileNumber || rrOrder?.customer_mobile_number,
                        customerEmail:
                            order.customerEmail ||
                            rrOrder?.customer_email ||
                            (order as any).user?.email,
                    },
                });

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
            } else {
                logger.warn("RoadRush refresh returned success but no order_status was found", {
                    orderId,
                    response: rrResponse,
                });
            }
        }

        throw new Error("Failed to refresh status from RoadRush: " + JSON.stringify(rrResponse));
    }
}
