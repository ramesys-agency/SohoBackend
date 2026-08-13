import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CouponType } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { CouponService } from "../coupon.service.js";

/**
 * What a coupon is allowed to take off a basket, and how many times it can be
 * taken. Both are money: the first decides the discount, the second decides
 * whether a single-use code can be spent twice by two shoppers who tap "place
 * order" in the same second.
 */

const db = () => prisma.getClient();

let coupons: CouponService;

let userId: string;
let otherUserId: string;
let addressId: string;
let otherAddressId: string;
let productId: string;
let otherProductId: string;
let collectionId: string;

beforeAll(async () => {
    coupons = new CouponService();
});

// Files share one database and run in sequence, so this one must not leave
// orders or users behind for the next file's deleteMany to trip over.
afterAll(async () => {
    await reset();
});

beforeEach(async () => {
    await reset();

    const [user, other] = await Promise.all([
        db().user.create({ data: { email: unique("shopper"), fullName: "Coupon Test" } }),
        db().user.create({ data: { email: unique("other"), fullName: "Other Shopper" } }),
    ]);
    userId = user.id;
    otherUserId = other.id;

    [addressId, otherAddressId] = await Promise.all([
        createAddress(user.id),
        createAddress(other.id),
    ]);

    const category = await db().category.create({
        data: { name: "Shirts", slug: unique("shirts") },
    });
    const [product, otherProduct] = await Promise.all([
        db().product.create({
            data: { categoryId: category.id, name: "Linen Shirt", attributes: {} },
        }),
        db().product.create({
            data: { categoryId: category.id, name: "Denim Jacket", attributes: {} },
        }),
    ]);
    productId = product.id;
    otherProductId = otherProduct.id;

    const collection = await db().collection.create({
        data: { name: "Summer", slug: unique("summer") },
    });
    collectionId = collection.id;
    await db().productCollection.create({ data: { productId, collectionId } });
});

describe("discount calculation", () => {
    it("caps a fixed-amount coupon at the items it applies to", async () => {
        // ৳500 off, but scoped to a collection holding only ৳200 of this basket.
        // The rest of the basket is not the coupon's to discount.
        const coupon = await createCoupon({
            type: CouponType.flat,
            value: "500",
            collectionIds: [collectionId],
        });

        const result = await coupons.validateCoupon(coupon.code, userId, [
            line(productId, 200, 1),
            line(otherProductId, 3000, 1),
        ]);

        expect(result.discountAmount).toBe(200);
        expect(result.newTotal).toBe(3000);
    });

    it("caps a fixed-amount coupon at the cart total when it applies to everything", async () => {
        const coupon = await createCoupon({ type: CouponType.flat, value: "500" });

        const result = await coupons.validateCoupon(coupon.code, userId, [line(productId, 300, 1)]);

        expect(result.discountAmount).toBe(300);
        expect(result.newTotal).toBe(0);
    });

    it("takes a percentage of the applicable items only", async () => {
        const coupon = await createCoupon({
            type: CouponType.percentage,
            value: "10",
            collectionIds: [collectionId],
        });

        const result = await coupons.validateCoupon(coupon.code, userId, [
            line(productId, 1000, 2),
            line(otherProductId, 5000, 1),
        ]);

        expect(result.discountAmount).toBe(200);
    });

    it("still honours maxDiscount", async () => {
        const coupon = await createCoupon({
            type: CouponType.percentage,
            value: "50",
            maxDiscount: "300",
        });

        const result = await coupons.validateCoupon(coupon.code, userId, [line(productId, 2000, 1)]);

        expect(result.discountAmount).toBe(300);
    });

    it("refuses a coupon that matches nothing in the basket", async () => {
        const coupon = await createCoupon({
            type: CouponType.flat,
            value: "100",
            collectionIds: [collectionId],
        });

        await expect(
            coupons.validateCoupon(coupon.code, userId, [line(otherProductId, 900, 1)])
        ).rejects.toThrow(/not applicable/i);
    });
});

describe("claiming a use", () => {
    it("lets two shoppers race for the last use and gives it to one of them", async () => {
        const coupon = await createCoupon({ type: CouponType.flat, value: "100", usageLimit: 1 });

        const results = await Promise.allSettled([
            claim(coupon.id, userId),
            claim(coupon.id, otherUserId),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

        const after = await db().coupon.findUniqueOrThrow({ where: { id: coupon.id } });
        expect(after.usageCount).toBe(1);
    });

    it("holds one customer to their own limit even when they order twice at once", async () => {
        const coupon = await createCoupon({
            type: CouponType.flat,
            value: "100",
            userUsageLimit: 1,
        });

        const results = await Promise.allSettled([
            claimAndOrder(coupon.id, userId),
            claimAndOrder(coupon.id, userId),
        ]);

        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

        const after = await db().coupon.findUniqueOrThrow({ where: { id: coupon.id } });
        expect(after.usageCount).toBe(1);
        expect(await db().order.count({ where: { couponId: coupon.id } })).toBe(1);
    });

    it("counts the customer's earlier orders against their limit", async () => {
        const coupon = await createCoupon({
            type: CouponType.flat,
            value: "100",
            userUsageLimit: 1,
        });
        await createOrder(userId, addressId, coupon.id);

        await expect(claim(coupon.id, userId)).rejects.toThrow(/already used this coupon/i);

        // Someone else's order is none of their business.
        await expect(claim(coupon.id, otherUserId)).resolves.toBeDefined();
    });

    it("refuses a coupon that expired between the quote and the sale", async () => {
        const coupon = await createCoupon({ type: CouponType.flat, value: "100" });

        // Quoted while live...
        await expect(
            coupons.validateCoupon(coupon.code, userId, [line(productId, 900, 1)])
        ).resolves.toMatchObject({ discountAmount: 100 });

        // ...and pulled before the order is written.
        await coupons.expireCoupon(coupon.id);

        await expect(claim(coupon.id, userId)).rejects.toThrow(/expired/i);
    });

    it("refuses a deactivated or deleted coupon", async () => {
        const inactive = await createCoupon({
            type: CouponType.flat,
            value: "100",
            isActive: false,
        });
        await expect(claim(inactive.id, userId)).rejects.toThrow(/inactive/i);

        const deleted = await createCoupon({ type: CouponType.flat, value: "100" });
        await coupons.deleteCoupon(deleted.id);
        await expect(claim(deleted.id, userId)).rejects.toThrow(/invalid coupon/i);
    });

    it("leaves the count alone when the claim fails", async () => {
        const coupon = await createCoupon({
            type: CouponType.flat,
            value: "100",
            usageLimit: 1,
            userUsageLimit: 5,
        });

        await claim(coupon.id, userId);
        await expect(claim(coupon.id, otherUserId)).rejects.toThrow(/usage limit reached/i);

        const after = await db().coupon.findUniqueOrThrow({ where: { id: coupon.id } });
        expect(after.usageCount).toBe(1);
    });
});

// --- Fixtures ---------------------------------------------------------------

const unique = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** One claim, in its own transaction — how the order path takes it. */
const claim = (couponId: string, forUserId: string) =>
    db().$transaction((tx) => coupons.claimUsage(tx, couponId, forUserId));

/**
 * The order path's actual sequence: claim, then write the order that spends it,
 * both in one transaction. The per-user limit counts orders, so the two steps
 * have to commit together for a second attempt to see the first one.
 */
const claimAndOrder = (couponId: string, forUserId: string) =>
    db().$transaction(async (tx) => {
        await coupons.claimUsage(tx, couponId, forUserId);
        return await tx.order.create({
            data: {
                userId: forUserId,
                addressId: forUserId === userId ? addressId : otherAddressId,
                couponId,
                totalAmount: "900",
            },
        });
    });

/** A cart line shaped the way the order path hands them over. */
const line = (forProductId: string, price: number, quantity: number) => ({
    quantity,
    variant: { productId: forProductId, basePrice: price },
});

async function createCoupon(data: {
    type: CouponType;
    value: string;
    maxDiscount?: string;
    usageLimit?: number;
    userUsageLimit?: number | null;
    isActive?: boolean;
    collectionIds?: string[];
}) {
    return await db().coupon.create({
        data: {
            code: unique("SAVE").toUpperCase(),
            type: data.type,
            value: data.value,
            validFrom: new Date(Date.now() - 60_000),
            ...(data.maxDiscount !== undefined && { maxDiscount: data.maxDiscount }),
            ...(data.usageLimit !== undefined && { usageLimit: data.usageLimit }),
            // Null unless a test is about the per-user limit — the column
            // defaults to 1, which would otherwise mask the global one.
            userUsageLimit: data.userUsageLimit ?? null,
            ...(data.isActive !== undefined && { isActive: data.isActive }),
            ...(data.collectionIds && {
                collections: { create: data.collectionIds.map((id) => ({ collectionId: id })) },
            }),
        },
    });
}

async function createAddress(forUserId: string): Promise<string> {
    const address = await db().address.create({
        data: {
            userId: forUserId,
            type: "home",
            street: "12 Gulshan Ave",
            postalCode: "1212",
            division: "Dhaka",
            district: "Dhaka",
            thana: "Gulshan",
        },
    });
    return address.id;
}

async function createOrder(forUserId: string, forAddressId: string, couponId: string) {
    return await db().order.create({
        data: { userId: forUserId, addressId: forAddressId, couponId, totalAmount: "900" },
    });
}

async function reset(): Promise<void> {
    const client = db();
    await client.order.deleteMany({});
    await client.couponCollection.deleteMany({});
    await client.coupon.deleteMany({});
    await client.productCollection.deleteMany({});
    await client.collection.deleteMany({});
    await client.product.deleteMany({});
    await client.category.deleteMany({});
    await client.address.deleteMany({});
    await client.user.deleteMany({});
}
