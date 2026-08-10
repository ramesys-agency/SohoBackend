import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OrderStatus, PaymentStatus, StatusSource } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { OrderService } from "../orders.service.js";
import { RoadRushService } from "../../logistics/roadrush.service.js";

/**
 * The two writers meeting on the same order.
 *
 * Everything here used to be last-write-wins on a single column: the poller
 * would overwrite an admin's decision, and the consequences of reaching a
 * status (stock, payment) only ever ran on the admin path. These are the cases
 * that broke.
 */

const db = () => prisma.getClient();

let orders: OrderService;

let variantId: string;
let userId: string;
let addressId: string;

beforeAll(async () => {
    orders = new OrderService();
});

afterAll(async () => {
    await resetOrders();
});

afterEach(() => {
    vi.restoreAllMocks();
});

beforeEach(async () => {
    await resetOrders();

    const user = await db().user.create({
        data: {
            email: `arbitration-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
            fullName: "Arbitration Test",
        },
    });
    userId = user.id;

    const address = await db().address.create({
        data: {
            userId: user.id,
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
        data: {
            name: "Shirts",
            slug: `shirts-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
    });
    const product = await db().product.create({
        data: { categoryId: category.id, name: "Linen Shirt", attributes: {} },
    });
    const variant = await db().productVariant.create({
        data: {
            productId: product.id,
            sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            size: "L",
            colorName: "Sand",
            stockQty: 10,
            basePrice: "1800",
        },
    });
    variantId = variant.id;
});

describe("the courier cannot undo an admin decision", () => {
    it("leaves a cancelled order cancelled, however live RoadRush thinks it is", async () => {
        const order = await createOrder(OrderStatus.processing);
        const stockBefore = await stockQty();

        await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Out of stock in Sand/L");
        const restocked = await stockQty();
        expect(restocked).toBe(stockBefore + 2);

        // RoadRush knows nothing about the cancellation — they have no cancel API.
        mockRoadRush("Rider Accepted");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.cancelled);
        // ...and the units stayed on the shelf rather than being taken twice.
        expect(await stockQty()).toBe(restocked);

        // The disagreement is surfaced instead of silently resolved.
        expect(after.statusConflict).toBe(true);
        expect(after.statusConflictReason).toMatch(/call them/i);
        expect(after.logisticsStatusName).toBe("Rider Accepted");
    });

    it("does not walk an order backwards on an out-of-order read", async () => {
        const order = await createOrder(OrderStatus.pending);

        mockRoadRush("Picked Up");
        await orders.refreshOrderStatus(order.id);
        expect((await db().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
            OrderStatus.shipped
        );

        // A later sweep catches RoadRush mid-hiccup, reporting an earlier state.
        mockRoadRush("Order Place");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.shipped);
        // The raw name is still recorded — we lose nothing, we just don't act on it.
        expect(after.logisticsStatusName).toBe("Order Place");
        expect(after.statusConflict).toBe(false);
    });

    it("tells the customer once, not once per sweep", async () => {
        const order = await createOrder(OrderStatus.pending);

        mockRoadRush("Picked Up");
        await orders.refreshOrderStatus(order.id);
        await orders.refreshOrderStatus(order.id);

        mockRoadRush("In Transit");
        await orders.refreshOrderStatus(order.id);

        // Three refreshes, one real move to `shipped`.
        expect(await db().notification.count({ where: { userId } })).toBe(1);
    });
});

describe("reaching a status costs the same whoever got there first", () => {
    it("settles the payment when RoadRush reports the delivery", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.cod_pending);

        mockRoadRush("Completed");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.delivered);
        expect(after.statusSource).toBe(StatusSource.roadrush);

        // Previously the poller left this at cod_pending, so the same order was
        // paid or unpaid depending on which writer reached delivered first.
        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.success);
    });
});

describe("a cancellation from RoadRush's side", () => {
    it("waits for a human rather than restocking on what may be a rider bouncing the job", async () => {
        const order = await createOrder(OrderStatus.processing);
        const stockBefore = await stockQty();

        mockRoadRush("Rider rejected");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.processing);
        expect(after.statusConflict).toBe(true);
        expect(after.statusConflictReason).toMatch(/restock/i);
        expect(await stockQty()).toBe(stockBefore);
    });

    it("is applied, with the restock, once an admin accepts it", async () => {
        const order = await createOrder(OrderStatus.processing);
        const stockBefore = await stockQty();

        mockRoadRush("Cancel");
        await orders.refreshOrderStatus(order.id);

        await orders.adminResolveStatusConflict(
            order.id,
            userId,
            "accept",
            "RoadRush cancelled it"
        );

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.cancelled);
        expect(after.statusSource).toBe(StatusSource.roadrush);
        expect(after.statusConflict).toBe(false);
        expect(await stockQty()).toBe(stockBefore + 2);
    });

    it("leaves the order alone when the admin keeps their own status", async () => {
        const order = await createOrder(OrderStatus.processing);

        mockRoadRush("Cancel");
        await orders.refreshOrderStatus(order.id);

        await orders.adminResolveStatusConflict(order.id, userId, "keep", "Rider is on the way");

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.processing);
        expect(after.adminStatusPinned).toBe(true);
        // Reviewed, so it drops out of the queue...
        expect(after.statusConflictAckAt).not.toBeNull();
        expect(await orders.adminGetStatusConflictCount()).toEqual({ pending: 0 });
    });

    it("comes back to the queue when RoadRush reports something new", async () => {
        const order = await createOrder(OrderStatus.processing);

        mockRoadRush("Cancel");
        await orders.refreshOrderStatus(order.id);
        await orders.adminResolveStatusConflict(order.id, userId, "keep");
        expect(await orders.adminGetStatusConflictCount()).toEqual({ pending: 0 });

        // ...and the pin holds against the courier's ordinary progression, but the
        // disagreement is put back in front of a human.
        mockRoadRush("In Transit");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.processing);
        expect(after.statusConflictAckAt).toBeNull();
        expect(await orders.adminGetStatusConflictCount()).toEqual({ pending: 1 });
    });

    it("refuses to resolve an order that is not in conflict", async () => {
        const order = await createOrder(OrderStatus.processing);

        await expect(orders.adminResolveStatusConflict(order.id, userId, "keep")).rejects.toThrow(
            /not in conflict/i
        );
    });
});

describe("a manually shipped order", () => {
    it("ignores a stale courier status — staff are delivering it themselves", async () => {
        const order = await createOrder(OrderStatus.processing);
        await db().order.update({
            where: { id: order.id },
            data: { orderType: "manual_shipping" },
        });

        mockRoadRush("Completed");
        await orders.refreshOrderStatus(order.id);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.processing);
    });
});

// --- Fixtures ---------------------------------------------------------------

/** Make `getOrderDetails` answer with one RoadRush status name. */
function mockRoadRush(statusName: string) {
    vi.spyOn(RoadRushService.prototype, "getOrderDetails").mockResolvedValue({
        status: "success",
        order: { status: statusName },
    } as any);
}

async function stockQty(): Promise<number> {
    const variant = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });
    return variant.stockQty;
}

/** One synced order for `userId` holding 2 units of the shared variant. */
async function createOrder(
    status: OrderStatus,
    paymentStatus: PaymentStatus = PaymentStatus.cod_pending
) {
    const variant = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });

    return await db().order.create({
        data: {
            userId,
            addressId,
            status,
            // Set so the order counts as handed off — without an order code
            // RoadRush has no say and none of these cases arise.
            orderCode: `RR-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            totalAmount: "3600",
            cod: true,
            items: {
                create: [
                    { productId: variant.productId, variantId, quantity: 2, priceAtBuy: "1800" },
                ],
            },
            payments: {
                create: [
                    {
                        provider: "COD",
                        providerPaymentId: `COD-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        amount: "3600",
                        currency: "BDT",
                        status: paymentStatus,
                    },
                ],
            },
        },
    });
}

/** Wipe what these tests touch, in FK-safe order. */
async function resetOrders(): Promise<void> {
    const client = db();
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
