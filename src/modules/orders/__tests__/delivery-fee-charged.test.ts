import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../../config/prisma.js";
import { config } from "../../../config/index.js";
import { OrderService } from "../orders.service.js";

/**
 * The delivery charge that ends up on the order. The rule itself is pinned in
 * checkout/__tests__/delivery-fee.test.ts; this is the money path — an order to
 * a Dhaka address has to be charged the inside rate, one anywhere else the
 * outside rate, and the total the courier collects has to include it.
 */

const db = () => prisma.getClient();
const orders = new OrderService();

const INSIDE = config.checkout.deliveryFees.INSIDE_DHAKA;
const OUTSIDE = config.checkout.deliveryFees.OUTSIDE_DHAKA;

const PRICE = 1000;

const unique = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

let userId: string;
let variantId: string;

beforeEach(async () => {
    await reset();

    const user = await db().user.create({
        data: {
            email: `${unique("delivery-fee")}@example.com`,
            fullName: "Delivery Fee Test",
            // Order creation refuses to place an order it cannot phone about.
            phone: "01700000000",
        },
    });
    userId = user.id;

    const category = await db().category.create({
        data: { name: "Shirts", slug: unique("shirts") },
    });
    const product = await db().product.create({
        data: { categoryId: category.id, name: "Linen Shirt", attributes: {} },
    });
    const variant = await db().productVariant.create({
        data: {
            productId: product.id,
            sku: unique("SKU"),
            stockQty: 10,
            basePrice: String(PRICE),
        },
    });
    variantId = variant.id;
});

afterAll(async () => {
    await reset();
});

describe("the delivery charge on a placed order", () => {
    it("charges the inside-Dhaka rate for a Dhaka address", async () => {
        const addressId = await address("Dhaka", "Dhaka");

        const order: any = await orders.createOrder(userId, {
            addressId,
            paymentMethod: "COD",
            buyNow: { variantId, quantity: 1 },
        } as any);

        expect(Number(order.shippingFee)).toBe(INSIDE);
        expect(Number(order.totalAmount)).toBe(PRICE + INSIDE);
    });

    it("charges the outside-Dhaka rate everywhere else", async () => {
        const addressId = await address("Chattogram", "Chattogram");

        const order: any = await orders.createOrder(userId, {
            addressId,
            paymentMethod: "COD",
            buyNow: { variantId, quantity: 1 },
        } as any);

        expect(Number(order.shippingFee)).toBe(OUTSIDE);
        expect(Number(order.totalAmount)).toBe(PRICE + OUTSIDE);
    });

    it("charges the outside rate for a Dhaka-division district outside the city", async () => {
        // Gazipur is in Dhaka division — pricing off the division would hand an
        // out-of-city run the cheaper city rate.
        const addressId = await address("Dhaka", "Gazipur");

        const order: any = await orders.createOrder(userId, {
            addressId,
            paymentMethod: "COD",
            buyNow: { variantId, quantity: 1 },
        } as any);

        expect(Number(order.shippingFee)).toBe(OUTSIDE);
    });

    it("hands the courier the fee-inclusive amount to collect", async () => {
        const addressId = await address("Dhaka", "Dhaka");

        const order: any = await orders.createOrder(userId, {
            addressId,
            paymentMethod: "COD",
            buyNow: { variantId, quantity: 1 },
        } as any);

        // What the customer agreed to is what the rider is told to collect.
        const payment = await db().payment.findFirstOrThrow({
            where: { orderId: order.id },
        });
        expect(Number(payment.amount)).toBe(PRICE + INSIDE);
        expect(Number(order.itemValue)).toBe(PRICE + INSIDE);
    });
});

// --- Fixtures ---------------------------------------------------------------

async function address(division: string, district: string): Promise<string> {
    const row = await db().address.create({
        data: {
            userId,
            type: "home",
            street: "12 Gulshan Ave",
            postalCode: "1212",
            division,
            district,
            thana: "Gulshan",
        },
    });
    return row.id;
}

async function reset(): Promise<void> {
    const client = db();
    await client.refund.deleteMany({});
    await client.return.deleteMany({});
    await client.inventoryLog.deleteMany({});
    await client.stockReservation.deleteMany({});
    await client.orderStatusLog.deleteMany({});
    await client.payment.deleteMany({});
    await client.logisticsJob.deleteMany({});
    await client.orderItem.deleteMany({});
    await client.order.deleteMany({});
    await client.cartItem.deleteMany({});
    await client.productVariant.deleteMany({});
    await client.product.deleteMany({});
    await client.category.deleteMany({});
    await client.address.deleteMany({});
    await client.notification.deleteMany({});
    await client.pushJob.deleteMany({});
    await client.pushToken.deleteMany({});
    await client.user.deleteMany({});
}
