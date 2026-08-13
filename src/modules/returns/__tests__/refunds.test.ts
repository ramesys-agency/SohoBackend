import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrderStatus, PaymentStatus, ReturnStatus } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { OrderService } from "../../orders/orders.service.js";
import { ReturnService } from "../returns.service.js";

/**
 * Money going back out. A refund has to be worth what the customer actually
 * paid for those units — not their list price — and the total sent back on an
 * order can never exceed what came in for it.
 */

const db = () => prisma.getClient();

let returns: ReturnService;
let orders: OrderService;

let userId: string;
let addressId: string;
let productId: string;
let variantId: string;

const SHIPPING = "150";
const ADMIN_ID = "admin-1";

beforeAll(async () => {
    returns = new ReturnService();
    orders = new OrderService();
});

afterAll(async () => {
    await reset();
});

beforeEach(async () => {
    await reset();

    const user = await db().user.create({
        data: { email: unique("refunds"), fullName: "Refund Test" },
    });
    userId = user.id;

    const address = await db().address.create({
        data: {
            userId,
            type: "home",
            street: "12 Gulshan Ave",
            postalCode: "1212",
            division: "Dhaka",
            district: "Dhaka",
            thana: "Gulshan",
        },
    });
    addressId = address.id;

    const category = await db().category.create({
        data: { name: "Shirts", slug: unique("shirts") },
    });
    const product = await db().product.create({
        data: { categoryId: category.id, name: "Linen Shirt", attributes: {} },
    });
    productId = product.id;

    const variant = await db().productVariant.create({
        data: { productId, sku: unique("SKU"), stockQty: 10, basePrice: "1000" },
    });
    variantId = variant.id;
});

describe("what a return is worth", () => {
    it("refunds the full line price when nothing was discounted", async () => {
        // 2 x ৳1000 + ৳150 delivery.
        const { itemId } = await deliveredOrder({ quantity: 2, total: "2150" });
        const row = await approvedReturn(itemId, 2);

        const refunded = await refund(row.id);

        expect(refunded.refundAmount?.toString()).toBe("2000");
    });

    it("takes the line's share of an order discount off the refund", async () => {
        // 2 x ৳1000, ৳500 off, + ৳150 delivery = ৳1650 paid.
        const { itemId } = await deliveredOrder({
            quantity: 2,
            total: "1650",
            discount: "500",
        });
        const row = await approvedReturn(itemId, 2);

        const refunded = await refund(row.id);

        // The customer paid ৳1500 for the goods, so that is what comes back —
        // not the ৳2000 they were listed at.
        expect(refunded.refundAmount?.toString()).toBe("1500");
    });

    it("spreads the discount across lines in proportion to their value", async () => {
        // ৳1000 + ৳3000 of goods, ৳400 off: the cheap line carries a quarter of it.
        const order = await createOrder({ total: "3750", discount: "400" });
        const cheap = await addItem(order.id, { quantity: 1, price: "1000" });
        await addItem(order.id, { quantity: 1, price: "3000" });

        const row = await approvedReturn(cheap.id, 1);
        const refunded = await refund(row.id);

        expect(refunded.refundAmount?.toString()).toBe("900");
    });

    it("refunds a partial return per unit", async () => {
        const { itemId } = await deliveredOrder({
            quantity: 3,
            total: "2850",
            discount: "300",
        });
        const row = await approvedReturn(itemId, 1);

        const refunded = await refund(row.id);

        // ৳3000 of goods less ৳300 = ৳2700 paid, so ৳900 a unit.
        expect(refunded.refundAmount?.toString()).toBe("900");
    });
});

describe("what a refund may not do", () => {
    it("refuses an amount larger than what is left refundable", async () => {
        const { itemId } = await deliveredOrder({ quantity: 1, total: "1150" });
        const row = await approvedReturn(itemId, 1);

        await expect(refund(row.id, "1000000")).rejects.toThrow(/still refundable/i);

        // Nothing was written — not the ledger, not the return.
        expect(await db().refund.count()).toBe(0);
        const after = await db().return.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.status).toBe(ReturnStatus.approved);
        expect(after.refundAmount).toBeNull();
    });

    it("lets an admin add the delivery charge but not a taka more", async () => {
        // ৳1000 of goods + ৳150 delivery: the whole ৳1150 may go back.
        const { itemId } = await deliveredOrder({ quantity: 1, total: "1150" });
        const row = await approvedReturn(itemId, 1);

        const refunded = await refund(row.id, "1150");
        expect(refunded.refundAmount?.toString()).toBe("1150");

        const second = await approvedReturn(itemId, 1);
        await expect(refund(second.id, "1")).rejects.toThrow(/already been refunded in full/i);
    });

    it("counts earlier refunds against the cap", async () => {
        const order = await createOrder({ total: "2150" });
        const first = await addItem(order.id, { quantity: 1, price: "1000" });
        const second = await addItem(order.id, { quantity: 1, price: "1000" });

        await refund((await approvedReturn(first.id, 1)).id, "1500");

        // ৳650 of ৳2150 left, so a second full-price refund cannot land.
        await expect(refund((await approvedReturn(second.id, 1)).id, "1000")).rejects.toThrow(
            /৳650/
        );
    });

    it("rejects a negative or unparseable amount", async () => {
        const { itemId } = await deliveredOrder({ quantity: 1, total: "1150" });
        const row = await approvedReturn(itemId, 1);

        await expect(refund(row.id, "-100")).rejects.toThrow(/positive number/i);
        await expect(refund(row.id, "abc")).rejects.toThrow(/must be a number/i);
    });
});

describe("the ledger and the payment", () => {
    it("writes one ledger row per refund, with who issued it", async () => {
        const { itemId, orderId } = await deliveredOrder({ quantity: 1, total: "1150" });
        const row = await approvedReturn(itemId, 1);

        await refund(row.id);

        const ledger = await db().refund.findMany({ where: { orderId } });
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.amount.toString()).toBe("1000");
        expect(ledger[0]?.returnId).toBe(row.id);
        expect(ledger[0]?.issuedBy).toBe(ADMIN_ID);
    });

    it("marks the payment refunded once the goods are fully paid back", async () => {
        // The old comparison was against the order total, delivery included, so
        // a fully returned order never reached it and the payment stayed 'paid'.
        const { itemId, orderId } = await deliveredOrder({ quantity: 1, total: "1150" });
        const row = await approvedReturn(itemId, 1);

        await refund(row.id);

        expect(await paymentStatus(orderId)).toBe(PaymentStatus.refunded);
    });

    it("leaves the payment alone while only part of the order is back", async () => {
        const order = await createOrder({ total: "2150" });
        const first = await addItem(order.id, { quantity: 1, price: "1000" });
        await addItem(order.id, { quantity: 1, price: "1000" });

        await refund((await approvedReturn(first.id, 1)).id);

        expect(await paymentStatus(order.id)).toBe(PaymentStatus.cod_collected);
    });

    it("will not stamp 'refunded' on money that was never collected", async () => {
        const { itemId, orderId } = await deliveredOrder({
            quantity: 1,
            total: "1150",
            paymentStatus: PaymentStatus.failed,
        });
        const row = await approvedReturn(itemId, 1);

        // The refund is still recorded — the operator says it happened — but the
        // payment is not rewritten into a story where cash came in and went back.
        const refunded = await refund(row.id);
        expect(refunded.refundAmount?.toString()).toBe("1000");
        expect(await paymentStatus(orderId)).toBe(PaymentStatus.failed);
    });
});

describe("refunding by hand from the dashboard", () => {
    it("records the money in the same ledger as a return refund", async () => {
        const { orderId } = await deliveredOrder({
            quantity: 1,
            total: "1150",
            status: OrderStatus.returned,
        });

        await orders.adminUpdatePaymentStatus(orderId, "refunded", ADMIN_ID);

        const ledger = await db().refund.findMany({ where: { orderId } });
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.amount.toString()).toBe("1150");
        expect(ledger[0]?.returnId).toBeNull();
        expect(ledger[0]?.issuedBy).toBe(ADMIN_ID);
    });

    it("stops the same money going back twice through a return", async () => {
        const { orderId, itemId } = await deliveredOrder({
            quantity: 1,
            total: "1150",
            status: OrderStatus.returned,
        });

        await orders.adminUpdatePaymentStatus(orderId, "refunded", ADMIN_ID);

        const row = await approvedReturn(itemId, 1);
        await expect(refund(row.id)).rejects.toThrow(/already been refunded in full/i);
    });

    it("only records what a partial return has not already paid back", async () => {
        // Two ৳1000 lines + ৳150 delivery. One line comes back, which is not the
        // whole order, so the payment is still outstanding when the admin settles
        // the rest by hand.
        const order = await createOrder({ total: "2150", status: OrderStatus.returned });
        const first = await addItem(order.id, { quantity: 1, price: "1000" });
        await addItem(order.id, { quantity: 1, price: "1000" });

        await refund((await approvedReturn(first.id, 1)).id);
        await orders.adminUpdatePaymentStatus(order.id, "refunded", ADMIN_ID);

        const ledger = await db().refund.findMany({
            where: { orderId: order.id },
            orderBy: { createdAt: "asc" },
        });
        expect(ledger.map((r) => r.amount.toString())).toEqual(["1000", "1150"]);
    });

    it("records nothing further when a return already settled the payment", async () => {
        const { orderId, itemId } = await deliveredOrder({
            quantity: 1,
            total: "1150",
            status: OrderStatus.returned,
        });

        // The return covered every taka of goods, so the payment is already
        // refunded. Pressing the button again changes nothing, and a status
        // change that moves no money must not write a row saying it did.
        await refund((await approvedReturn(itemId, 1)).id);
        await orders.adminUpdatePaymentStatus(orderId, "refunded", ADMIN_ID);

        expect(await db().refund.count({ where: { orderId } })).toBe(1);
    });
});

// --- Fixtures ---------------------------------------------------------------

const unique = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const refund = (returnId: string, amount?: string) =>
    returns.adminUpdateReturnStatus(
        returnId,
        { status: ReturnStatus.refunded, ...(amount !== undefined && { refundAmount: amount }) },
        ADMIN_ID
    );

async function paymentStatus(orderId: string): Promise<PaymentStatus> {
    const payment = await db().payment.findFirstOrThrow({
        where: { orderId },
        orderBy: { createdAt: "desc" },
    });
    return payment.status;
}

async function createOrder(params: {
    total: string;
    discount?: string;
    paymentStatus?: PaymentStatus;
    status?: OrderStatus;
}) {
    return await db().order.create({
        data: {
            userId,
            addressId,
            status: params.status ?? OrderStatus.delivered,
            totalAmount: params.total,
            shippingFee: SHIPPING,
            ...(params.discount && { discountAmount: params.discount }),
            cod: true,
            payments: {
                create: [
                    {
                        provider: "COD",
                        providerPaymentId: unique("COD"),
                        amount: params.total,
                        currency: "BDT",
                        status: params.paymentStatus ?? PaymentStatus.cod_collected,
                    },
                ],
            },
        },
    });
}

async function addItem(orderId: string, params: { quantity: number; price: string }) {
    return await db().orderItem.create({
        data: {
            orderId,
            productId,
            variantId,
            quantity: params.quantity,
            priceAtBuy: params.price,
        },
    });
}

/** A delivered, collected-for order holding one line. */
async function deliveredOrder(params: {
    quantity: number;
    total: string;
    discount?: string;
    paymentStatus?: PaymentStatus;
    status?: OrderStatus;
}) {
    const order = await createOrder({
        total: params.total,
        ...(params.discount && { discount: params.discount }),
        ...(params.paymentStatus && { paymentStatus: params.paymentStatus }),
        ...(params.status && { status: params.status }),
    });
    const item = await addItem(order.id, { quantity: params.quantity, price: "1000" });

    return { orderId: order.id, itemId: item.id };
}

/**
 * A return sitting at `approved`, the state a refund is issued from. Written
 * directly so these tests are about the money, not about the return ladder.
 */
async function approvedReturn(orderItemId: string, quantity: number) {
    return await db().return.create({
        data: {
            orderItemId,
            quantity,
            reason: "Wrong fit",
            status: ReturnStatus.approved,
        },
    });
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
    await client.productVariant.deleteMany({});
    await client.product.deleteMany({});
    await client.category.deleteMany({});
    await client.address.deleteMany({});
    await client.notification.deleteMany({});
    await client.pushJob.deleteMany({});
    await client.pushToken.deleteMany({});
    await client.user.deleteMany({});
}
