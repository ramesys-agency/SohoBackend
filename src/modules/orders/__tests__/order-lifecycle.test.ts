import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrderStatus, PaymentStatus } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { OrderService } from "../orders.service.js";
import { ReturnService } from "../../returns/returns.service.js";

/**
 * The admin-facing order lifecycle: statuses only ever move forward along
 * placed -> processing -> shipped -> delivered, a cancellation always carries a
 * reason for the customer, and money follows the goods.
 */

const db = () => prisma.getClient();

let orders: OrderService;
let returns: ReturnService;

/** Reusable catalogue rows — created once, the orders are per-test. */
let variantId: string;
let userId: string;
let addressId: string;

beforeAll(async () => {
    orders = new OrderService();
    returns = new ReturnService();
});

// The suite shares one database and files run in sequence, so this file must not
// leave orders behind — a later file's `user.deleteMany` would hit Order's FK.
afterAll(async () => {
    await resetOrders();
});

beforeEach(async () => {
    await resetOrders();

    const user = await db().user.create({
        data: {
            email: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
            fullName: "Lifecycle Test",
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
        data: { name: "Shirts", slug: `shirts-${Date.now()}-${Math.random().toString(36).slice(2)}` },
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

describe("admin status transitions", () => {
    it("refuses to skip a rung of the ladder", async () => {
        const order = await createOrder(OrderStatus.pending);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.shipped)
        ).rejects.toThrow(/can only move to/i);

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.pending);
    });

    it("walks pending -> processing -> shipped -> delivered", async () => {
        const order = await createOrder(OrderStatus.pending);

        for (const next of [OrderStatus.processing, OrderStatus.shipped, OrderStatus.delivered]) {
            await orders.updateOrderStatus(order.id, next);
        }

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.delivered);
    });

    it("will not cancel without a reason for the customer", async () => {
        const order = await createOrder(OrderStatus.pending);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.cancelled)
        ).rejects.toThrow(/reason is required/i);
        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.cancelled, "   ")
        ).rejects.toThrow(/reason is required/i);
    });

    it("cancels with a reason, restocks the units and shows the reason on the timeline", async () => {
        const order = await createOrder(OrderStatus.processing);
        const before = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });

        await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Out of stock in Sand/L");

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.cancelled);

        const variant = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });
        expect(variant.stockQty).toBe(before.stockQty + 2);

        const log = await db().orderStatusLog.findFirstOrThrow({
            where: { orderId: order.id, status: OrderStatus.cancelled },
        });
        expect(log.note).toBe("Out of stock in Sand/L");
        expect(log.internal).toBe(false);
    });

    it("keeps cancel available at every rung before delivery", async () => {
        for (const status of [OrderStatus.pending, OrderStatus.processing, OrderStatus.shipped]) {
            const order = await createOrder(status);
            await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Courier lost the parcel");

            const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
            expect(after.status).toBe(OrderStatus.cancelled);
        }
    });

    it("treats a delivered order as final except for a return", async () => {
        const order = await createOrder(OrderStatus.delivered);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Nope")
        ).rejects.toThrow(/can only move to/i);

        await orders.updateOrderStatus(order.id, OrderStatus.returned, "Wrong fit");
        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.returned);
    });

    it("lets nothing out of cancelled or returned", async () => {
        const cancelled = await createOrder(OrderStatus.cancelled);
        await expect(
            orders.updateOrderStatus(cancelled.id, OrderStatus.processing)
        ).rejects.toThrow(/final/i);

        const returned = await createOrder(OrderStatus.returned);
        await expect(
            orders.updateOrderStatus(returned.id, OrderStatus.delivered)
        ).rejects.toThrow(/final/i);
    });

    it("rejects a no-op and an unknown status", async () => {
        const order = await createOrder(OrderStatus.pending);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.pending)
        ).rejects.toThrow(/already pending/i);
        await expect(
            orders.updateOrderStatus(order.id, "on_a_boat" as OrderStatus)
        ).rejects.toThrow(/invalid order status/i);
    });
});

describe("status override", () => {
    it("reaches a status the ladder forbids", async () => {
        const order = await createOrder(OrderStatus.pending);

        await orders.updateOrderStatus(order.id, OrderStatus.delivered, undefined, {
            override: true,
        });

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.delivered);
    });

    it("walks a mistaken delivery back", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.cod_pending);
        await orders.updateOrderStatus(order.id, OrderStatus.delivered);

        await orders.updateOrderStatus(order.id, OrderStatus.shipped, "Marked delivered by mistake", {
            override: true,
            resetPayment: true,
        });

        const after = await db().order.findUniqueOrThrow({ where: { id: order.id } });
        expect(after.status).toBe(OrderStatus.shipped);

        // The delivery settled the payment, so undoing it un-settles it.
        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.cod_pending);
    });

    it("leaves the payment settled when the money really did come in", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.cod_pending);
        await orders.updateOrderStatus(order.id, OrderStatus.delivered);

        await orders.updateOrderStatus(order.id, OrderStatus.shipped, undefined, {
            override: true,
            resetPayment: false,
        });

        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.success);
    });

    it("keeps a delivered order's payment settled when it is cancelled, so it can be refunded", async () => {
        const order = await createOrder(OrderStatus.delivered, PaymentStatus.success);

        await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Customer never got it", {
            override: true,
            resetPayment: true,
        });

        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.success);

        // ...and the refund path is open, which a reset to unpaid would have shut.
        const refunded = await orders.adminUpdatePaymentStatus(order.id, "refunded");
        expect(refunded.status).toBe(PaymentStatus.refunded);
    });

    it("never un-settles a refund", async () => {
        const order = await createOrder(OrderStatus.returned, PaymentStatus.refunded);

        await orders.updateOrderStatus(order.id, OrderStatus.processing, undefined, {
            override: true,
            resetPayment: true,
        });

        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.refunded);
    });

    it("takes the units back off the shelf when a cancellation is undone", async () => {
        const order = await createOrder(OrderStatus.processing);
        const before = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });

        await orders.updateOrderStatus(order.id, OrderStatus.cancelled, "Cancelled by mistake");
        const restocked = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });
        expect(restocked.stockQty).toBe(before.stockQty + 2);

        await orders.updateOrderStatus(order.id, OrderStatus.processing, undefined, {
            override: true,
        });

        const after = await db().productVariant.findUniqueOrThrow({ where: { id: variantId } });
        expect(after.stockQty).toBe(before.stockQty);

        const logs = await db().inventoryLog.findMany({
            where: { referenceId: order.id },
            orderBy: { createdAt: "asc" },
        });
        expect(logs.map((l) => [l.reason, l.changeQty])).toEqual([
            ["order_cancelled", 2],
            ["order_cancel_reverted", -2],
        ]);
    });

    it("still insists on a reason when the override is a cancellation", async () => {
        const order = await createOrder(OrderStatus.delivered);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.cancelled, undefined, { override: true })
        ).rejects.toThrow(/reason is required/i);
    });

    it("still refuses a no-op and an unknown status", async () => {
        const order = await createOrder(OrderStatus.delivered);

        await expect(
            orders.updateOrderStatus(order.id, OrderStatus.delivered, undefined, { override: true })
        ).rejects.toThrow(/already delivered/i);
        await expect(
            orders.updateOrderStatus(order.id, "sideways" as OrderStatus, undefined, {
                override: true,
            })
        ).rejects.toThrow(/invalid order status/i);
    });
});

describe("delivered means paid", () => {
    it("settles the payment when the order is marked delivered", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.cod_pending);

        await orders.updateOrderStatus(order.id, OrderStatus.delivered);

        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.success);
    });

    it("leaves an already-refunded payment alone", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.refunded);

        await orders.updateOrderStatus(order.id, OrderStatus.delivered);

        const payment = await db().payment.findFirstOrThrow({ where: { orderId: order.id } });
        expect(payment.status).toBe(PaymentStatus.refunded);
    });

    it("refuses to collect money before the order is delivered", async () => {
        const order = await createOrder(OrderStatus.shipped, PaymentStatus.cod_pending);

        await expect(orders.adminUpdatePaymentStatus(order.id, "success")).rejects.toThrow(
            /can only be marked "success" on a delivered or returned order/i
        );
    });

    it("allows the not-received escape hatch on a delivered order", async () => {
        const order = await createOrder(OrderStatus.delivered, PaymentStatus.success);

        const payment = await orders.adminUpdatePaymentStatus(order.id, "failed");
        expect(payment.status).toBe(PaymentStatus.failed);
    });

    it("only refunds an order that came back or never went out", async () => {
        const delivered = await createOrder(OrderStatus.delivered, PaymentStatus.success);
        await expect(orders.adminUpdatePaymentStatus(delivered.id, "refunded")).rejects.toThrow(
            /returned or cancelled/i
        );

        const returned = await createOrder(OrderStatus.returned, PaymentStatus.success);
        const payment = await orders.adminUpdatePaymentStatus(returned.id, "refunded");
        expect(payment.status).toBe(PaymentStatus.refunded);
    });

    it("tells the customer when their payment is refunded, once", async () => {
        const order = await createOrder(OrderStatus.returned, PaymentStatus.success);

        await orders.adminUpdatePaymentStatus(order.id, "refunded");

        const notification = await db().notification.findFirstOrThrow({ where: { userId } });
        expect(notification.title).toBe("Refund processed");
        expect(notification.body).toContain("3,600");
        expect(notification.type).toBe("order");

        // Re-saving the same status is not news.
        await orders.adminUpdatePaymentStatus(order.id, "refunded");
        expect(await db().notification.count({ where: { userId } })).toBe(1);
    });

    it("says nothing to the customer when the payment is merely collected", async () => {
        const order = await createOrder(OrderStatus.delivered, PaymentStatus.cod_pending);

        await orders.adminUpdatePaymentStatus(order.id, "success");

        expect(await db().notification.count({ where: { userId } })).toBe(0);
    });

    it("will not push a payment back to pending by hand", async () => {
        const order = await createOrder(OrderStatus.delivered, PaymentStatus.success);

        await expect(orders.adminUpdatePaymentStatus(order.id, "cod_pending")).rejects.toThrow(
            /cannot be set back/i
        );
    });
});

describe("customer payload", () => {
    it("includes the delivery OTP — the app shows it to the customer for the rider", async () => {
        const order = await createOrder(OrderStatus.shipped);
        await db().order.update({ where: { id: order.id }, data: { otp: "482913" } });

        const asCustomer: any = await orders.getOrderById(userId, order.id);
        expect(asCustomer.otp).toBe("482913");
    });

    it("still keeps the manual-shipping fields to staff", async () => {
        const order = await createOrder(OrderStatus.pending);
        await db().order.update({
            where: { id: order.id },
            data: { manualReason: "Courier API returned 500" },
        });

        const asCustomer: any = await orders.getOrderById(userId, order.id);
        expect(asCustomer.manualReason).toBeUndefined();

        const asAdmin: any = await orders.getOrderById(userId, order.id, "admin");
        expect(asAdmin.manualReason).toBe("Courier API returned 500");
    });
});

describe("returns", () => {
    it("cannot be recorded before the order is delivered", async () => {
        const order = await createOrder(OrderStatus.shipped);
        const item = await db().orderItem.findFirstOrThrow({ where: { orderId: order.id } });

        await expect(
            returns.adminCreateReturns(order.id, {
                items: [{ orderItemId: item.id, reason: "Wrong fit", quantity: 1 }],
            })
        ).rejects.toThrow(/only a delivered order can be returned/i);
    });

    it("can be recorded once the order is delivered", async () => {
        const order = await createOrder(OrderStatus.delivered, PaymentStatus.success);
        const item = await db().orderItem.findFirstOrThrow({ where: { orderId: order.id } });

        const created = await returns.adminCreateReturns(order.id, {
            items: [{ orderItemId: item.id, reason: "Wrong fit", quantity: 1 }],
        });

        expect(created).toHaveLength(1);
    });
});

// --- Fixtures ---------------------------------------------------------------

/** One order for `userId` holding 2 units of the shared variant. */
async function createOrder(
    status: OrderStatus,
    paymentStatus: PaymentStatus = PaymentStatus.cod_pending
) {
    const order = await db().order.create({
        data: {
            userId,
            addressId,
            status,
            totalAmount: "3600",
            cod: true,
            items: {
                create: [{ productId: await productIdFor(variantId), variantId, quantity: 2, priceAtBuy: "1800" }],
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

    return order;
}

async function productIdFor(variant: string): Promise<string> {
    const row = await db().productVariant.findUniqueOrThrow({ where: { id: variant } });
    return row.productId;
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
