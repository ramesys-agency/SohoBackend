import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { LogisticsJobStatus, OrderStatus } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { OrderService } from "../../orders/orders.service.js";
import { logisticsJobService } from "../logistics-job.service.js";

/**
 * A cancelled order must never be handed to RoadRush. The hand-off is a durable
 * retry queue that can fire minutes or hours after the order was placed, so
 * "cancelled" and "already dispatched" are two states that have to be kept
 * apart — otherwise a rider turns up and collects cash for goods nobody owes.
 *
 * Nothing here reaches the partner: every case is decided before the first
 * RoadRush call.
 */

const db = () => prisma.getClient();

let orders: OrderService;

let userId: string;
let addressId: string;
let productId: string;
let variantId: string;

beforeAll(async () => {
    orders = new OrderService();
});

afterAll(async () => {
    await reset();
});

beforeEach(async () => {
    await reset();

    const user = await db().user.create({
        data: { email: unique("courier"), fullName: "Courier Test" },
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

describe("cancelling an order", () => {
    it("takes its queued hand-off off the queue", async () => {
        const order = await placedOrder();
        await queueJob(order.id);

        await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Customer changed their mind");

        const job = await db().logisticsJob.findUniqueOrThrow({ where: { orderId: order.id } });
        expect(job.status).toBe(LogisticsJobStatus.cancelled);
    });

    it("leaves the queue alone for an order that is still going out", async () => {
        const order = await placedOrder();
        await queueJob(order.id);

        await orders.updateOrderStatus(order.id, OrderStatus.processing);

        const job = await db().logisticsJob.findUniqueOrThrow({ where: { orderId: order.id } });
        expect(job.status).toBe(LogisticsJobStatus.pending);
    });
});

describe("the retry queue", () => {
    it("refuses to dispatch a job whose order was cancelled after it was claimed", async () => {
        const order = await placedOrder({ status: OrderStatus.cancelled });
        // A job that survived the cancellation — claimed by a worker a moment
        // before it landed, or left behind by an older release.
        const job = await queueJob(order.id, { status: LogisticsJobStatus.processing });

        const outcome = await logisticsJobService.processJob(job);

        expect(outcome).toBe("skipped");
        const after = await db().logisticsJob.findUniqueOrThrow({ where: { id: job.id } });
        expect(after.status).toBe(LogisticsJobStatus.cancelled);
        expect(after.lastError).toMatch(/cancelled/i);

        // Never handed over, so it has no courier code and is not staff's problem.
        const orderAfter = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(orderAfter.orderCode).toBeNull();
        expect(orderAfter.manualFlaggedAt).toBeNull();
    });

    it("refuses a hand-cranked retry of a cancelled order", async () => {
        const order = await placedOrder({ status: OrderStatus.cancelled });
        await queueJob(order.id);

        await expect(orders.adminRetrySync(order.id)).rejects.toThrow(/cancelled order/i);
    });

    it("refuses a hand sync of a cancelled order", async () => {
        const order = await placedOrder({ status: OrderStatus.cancelled });

        await expect(orders.syncOrderWithRoadRush(order.id)).rejects.toThrow(/cancelled order/i);
    });
});

// --- Fixtures ---------------------------------------------------------------

const unique = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function placedOrder(params?: { status?: OrderStatus }) {
    return await db().order.create({
        data: {
            userId,
            addressId,
            status: params?.status ?? OrderStatus.pending,
            totalAmount: "1150",
            shippingFee: "150",
            cod: true,
            items: { create: [{ productId, variantId, quantity: 1, priceAtBuy: "1000" }] },
        },
    });
}

async function queueJob(orderId: string, params?: { status?: LogisticsJobStatus }) {
    return await db().logisticsJob.create({
        data: {
            orderId,
            status: params?.status ?? LogisticsJobStatus.pending,
            payload: {
                customer_full_name: "Courier Test",
                customer_mobile_number: "01700000000",
                item_value: 1150,
                cod: true,
            },
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
