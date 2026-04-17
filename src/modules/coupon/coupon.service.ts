import { PrismaService } from "../../core/services/index.js";
import { NotFoundError, BadRequestError } from "../../core/errors/http-errors.js";

export class CouponService {
    private prisma: PrismaService = new PrismaService();

    async createCoupon(data: any) {
        return await this.prisma.getClient().coupon.create({
            data: {
                code: data.code.toUpperCase(),
                type: data.type,
                value: data.value,
                minOrderAmount: data.minOrderAmount || 0,
                maxDiscount: data.maxDiscount,
                validFrom: data.validFrom ? new Date(data.validFrom) : new Date(),
                validTo: data.validTo ? new Date(data.validTo) : null,
                isActive: data.isActive !== undefined ? data.isActive : true,
                usageLimit: data.usageLimit,
                userUsageLimit: data.userUsageLimit || 1,
                collections: {
                    create: data.collectionIds?.map((id: string) => ({
                        collectionId: id,
                    })),
                },
            },
            include: {
                collections: {
                    include: {
                        collection: true,
                    },
                },
            },
        });
    }

    async getAllCoupons() {
        return await this.prisma.getClient().coupon.findMany({
            where: { isDeleted: false },
            include: {
                collections: {
                    include: {
                        collection: true,
                    },
                },
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async getCouponById(id: string) {
        const coupon = await this.prisma.getClient().coupon.findFirst({
            where: { id, isDeleted: false },
            include: {
                collections: {
                    include: {
                        collection: true,
                    },
                },
                orders: {
                    include: {
                        user: true,
                    },
                    orderBy: { createdAt: "desc" },
                },
            },
        });
        if (!coupon) throw new NotFoundError("Coupon not found");
        return coupon;
    }

    async updateCoupon(id: string, data: any) {
        return await this.prisma.getClient().$transaction(async (tx) => {
            if (data.collectionIds) {
                await tx.couponCollection.deleteMany({ where: { couponId: id } });
            }

            return await tx.coupon.update({
                where: { id },
                data: {
                    ...(data.code && { code: data.code.toUpperCase() }),
                    ...(data.type && { type: data.type }),
                    ...(data.value !== undefined && { value: data.value }),
                    ...(data.minOrderAmount !== undefined && { minOrderAmount: data.minOrderAmount }),
                    ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
                    ...(data.validFrom && { validFrom: new Date(data.validFrom) }),
                    ...(data.validTo !== undefined && { validTo: data.validTo ? new Date(data.validTo) : null }),
                    ...(data.isActive !== undefined && { isActive: data.isActive }),
                    ...(data.usageLimit !== undefined && { usageLimit: data.usageLimit }),
                    ...(data.userUsageLimit !== undefined && { userUsageLimit: data.userUsageLimit }),
                    ...(data.collectionIds && {
                        collections: {
                            create: data.collectionIds.map((cid: string) => ({
                                collectionId: cid,
                            })),
                        },
                    }),
                },
                include: {
                    collections: {
                        include: {
                            collection: true,
                        },
                    },
                },
            });
        });
    }

    async deleteCoupon(id: string) {
        return await this.prisma.getClient().coupon.update({
            where: { id },
            data: { isDeleted: true },
        });
    }

    async expireCoupon(id: string) {
        return await this.prisma.getClient().coupon.update({
            where: { id },
            data: { validTo: new Date() },
        });
    }

    async validateCoupon(code: string, userId: string, cartItems: any[]) {
        const coupon = await this.prisma.getClient().coupon.findUnique({
            where: { code: code.toUpperCase() },
            include: {
                collections: true,
                orders: {
                    where: { userId },
                },
            },
        });

        if (!coupon || coupon.isDeleted) {
            throw new BadRequestError("Invalid coupon code");
        }

        return await this.applyCouponLogic(coupon, userId, cartItems);
    }

    async applyCouponLogic(coupon: any, userId: string, cartItems: any[]) {
        if (!coupon.isActive) {
            throw new BadRequestError("Coupon is inactive");
        }

        const now = new Date();
        if (now < coupon.validFrom) {
            throw new BadRequestError("Coupon is not yet valid");
        }
        if (coupon.validTo && now > coupon.validTo) {
            throw new BadRequestError("Coupon has expired");
        }

        if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
            throw new BadRequestError("Coupon usage limit reached");
        }

        // Check user usage limit
        // coupon.orders was included in validateCoupon, but for internal use we might need to fetch it if not provided
        const userOrdersCount = coupon.orders 
            ? coupon.orders.length 
            : await this.prisma.getClient().order.count({
                where: { couponId: coupon.id, userId }
            });

        if (coupon.userUsageLimit && userOrdersCount >= coupon.userUsageLimit) {
            throw new BadRequestError("You have already used this coupon maximum number of times");
        }

        // Calculate order total for applicable items
        let totalAmount = 0;
        let applicableAmount = 0;

        const collectionIds = coupon.collections.map((c: any) => c.collectionId);

        for (const item of cartItems) {
            const itemPrice = Number(item.variant.basePrice) * item.quantity;
            totalAmount += itemPrice;

            if (collectionIds.length === 0) {
                // Applicable to everything
                applicableAmount += itemPrice;
            } else {
                // Check if product belongs to any of the collections
                const productInCollection = await this.prisma.getClient().productCollection.findFirst({
                    where: {
                        productId: item.variant.productId,
                        collectionId: { in: collectionIds },
                    },
                });
                if (productInCollection) {
                    applicableAmount += itemPrice;
                }
            }
        }

        if (totalAmount < Number(coupon.minOrderAmount)) {
            throw new BadRequestError(`Minimum order amount of ${coupon.minOrderAmount} required`);
        }

        if (applicableAmount === 0) {
            throw new BadRequestError("This coupon is not applicable to any items in your cart");
        }

        // Calculate discount
        let discount = 0;
        if (coupon.type === "percentage") {
            discount = (applicableAmount * Number(coupon.value)) / 100;
        } else {
            discount = Number(coupon.value);
        }

        if (coupon.maxDiscount && discount > Number(coupon.maxDiscount)) {
            discount = Number(coupon.maxDiscount);
        }

        // Ensure discount doesn't exceed total amount
        if (discount > totalAmount) {
            discount = totalAmount;
        }

        return {
            couponId: coupon.id,
            code: coupon.code,
            discountAmount: discount,
            newTotal: totalAmount - discount,
        };
    }

    async incrementUsage(tx: any, couponId: string) {
        return await tx.coupon.update({
            where: { id: couponId },
            data: {
                usageCount: {
                    increment: 1,
                },
            },
        });
    }
}

