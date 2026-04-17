import { PrismaService } from "../../core/services/index.js";
import { NotFoundError, ForbiddenError } from "../../core/errors/http-errors.js";
import { RoadRushService } from "../logistics/roadrush.service.js";
import { logger } from "../../config/logger.js";
import { OrderStatus } from "../../generated/prisma/index.js";

export class OrderService {
    private prisma: PrismaService = new PrismaService();
    private roadRush: RoadRushService = new RoadRushService();

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

    async getOrderById(userId: string, orderId: string) {
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

        if (order.userId !== userId) {
            throw new ForbiddenError("You are not authorized to view this order");
        }

        return order;
    }

    async createOrder(userId: string, data: any) {
        // 1. Get Cart Items to compute total and details
        const cartItems = await this.prisma.getClient().cartItem.findMany({
            where: { userId },
            include: {
                variant: {
                    include: { product: true },
                },
            },
        });

        if (cartItems.length === 0) {
            throw new Error("Cannot place order with an empty cart");
        }

        // 2. Fetch Drop Address
        const address = await this.prisma.getClient().address.findUnique({
            where: { id: data.addressId },
            include: { user: true },
        });
        if (!address) throw new NotFoundError("Drop address not found");

        // 3. Compute Totals
        let totalAmount = 0;
        const itemDetails = cartItems
            .map(
                (i) =>
                    `${i.variant.product.name} (${i.variant.size || ""} ${i.variant.colorName || ""}) x${
                        i.quantity
                    }`
            )
            .join(", ");

        cartItems.forEach((item) => {
            totalAmount += Number(item.variant.basePrice) * item.quantity;
        });

        // 4. Create Order & Payment in a transaction
        const order = await this.prisma.getClient().$transaction(async (tx) => {
            // Create Order record
            const newOrder = await tx.order.create({
                data: {
                    userId,
                    addressId: data.addressId,
                    totalAmount,
                    aggregator: data.aggregator,
                    cod: data.paymentMethod === "COD",
                    itemValue: totalAmount,
                    itemDetails,
                    receiverDivision: address.division,
                    receiverDistrict: address.district,
                    receiverThana: address.thana,
                    dropAddress: address.dropAddress || address.street,
                    customerMobileNumber: address.user.phone || data.customerPhone || "",

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

            // Clear the User's Cart
            await tx.cartItem.deleteMany({ where: { userId } });

            return newOrder;
        });

        // 5. External RoadRush Order Placement (Fire and forget or async)
        // This is done outside the transaction to avoid blocking DB if RoadRush API is slow.
        try {
            const rrResponse = await this.roadRush.placeOrder({
                marcent_pickup_address_id: data.pickupAddressId, // Provided by frontend from list of pickup addresses
                aggregator: data.aggregator,
                receiver_division: address.division,
                receiver_district: address.district,
                receiver_thana: address.thana,
                drop_address: address.dropAddress || address.street,
                customer_full_name: data.customerFullName || "Customer",
                customer_mobile_number: address.user.phone || data.customerPhone || "",
                item_value: totalAmount,
                cod: data.paymentMethod === "COD",
                item_details: itemDetails,
            });

            if (rrResponse.status === "success") {
                // Attach the RoadRush Order Code (rd#...) for tracking
                await this.prisma.getClient().order.update({
                    where: { id: order.id },
                    data: { orderCode: rrResponse.order.order_code },
                });
            }
        } catch (error) {
            logger.error("Failed to sync order with RoadRush logistics", {
                orderId: order.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        return order;
    }

    async adminGetAllOrders() {
        return await this.prisma.getClient().order.findMany({
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
        return await this.prisma.getClient().order.update({
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

        return await this.prisma.getClient().payment.update({
            where: { id: payment.id },
            data: {
                status: status as any,
            },
        });
    }
}
