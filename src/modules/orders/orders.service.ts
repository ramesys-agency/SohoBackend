import { PrismaService } from "../../core/services/index.js";
import { NotFoundError, ForbiddenError, BadRequestError } from "../../core/errors/http-errors.js";
import { RoadRushService } from "../logistics/roadrush.service.js";
import { CouponService } from "../coupon/coupon.service.js";
import { logger } from "../../config/logger.js";
import { OrderStatus } from "../../generated/prisma/index.js";

export class OrderService {
    private prisma: PrismaService = new PrismaService();
    private roadRush: RoadRushService = new RoadRushService();
    private couponService: CouponService = new CouponService();

    // ... (getAllOrders and getOrderById omitted for brevity, keeping them original) ...

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
            throw new BadRequestError("Cannot place order with an empty cart");
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
                const couponResult = await this.couponService.validateCoupon(data.couponCode, userId, cartItems);
                discountAmount = couponResult.discountAmount;
                couponId = couponResult.couponId;
            } catch (error) {
                logger.warn("Invalid coupon provided during order creation", { code: data.couponCode, userId });
                // We can choose to throw or just ignore the coupon. 
                // Usually, throwing is safer to avoid price discrepancies.
                throw error;
            }
        }

        const totalAmount = subtotal - discountAmount;

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
