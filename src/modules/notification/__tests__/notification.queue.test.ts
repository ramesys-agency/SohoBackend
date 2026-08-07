import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PushJobStatus } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { NotificationService } from "../notification.service.js";
import { PushJobService } from "../push-job.service.js";
import { PushJobWorker } from "../push-job.worker.js";
import { FakeExpo, addDevice, createUser, resetDatabase } from "./helpers.js";

const db = () => prisma.getClient();

let expo: FakeExpo;
let queue: PushJobService;
let worker: PushJobWorker;
let notifications: NotificationService;

beforeAll(async () => {
    await prisma.connect();
});

afterAll(async () => {
    await prisma.disconnect();
});

beforeEach(async () => {
    await resetDatabase();
    expo = new FakeExpo();
    queue = new PushJobService(expo.asExpo());
    worker = new PushJobWorker(queue);
    notifications = new NotificationService();
});

describe("order updates", () => {
    it("queues delivery instead of firing it inline", async () => {
        const user = await createUser();
        const ios = await addDevice(user.id, "ios");
        const android = await addDevice(user.id, "android");

        await notifications.notifyOrderStatusChange({
            userId: user.id,
            orderId: "11111111-2222-3333-4444-555555555555",
            orderCode: "SOHO-123",
            status: "shipped",
        });

        // The in-app row exists immediately...
        const notification = await db().notification.findFirstOrThrow();
        expect(notification.title).toBe("Order shipped");
        expect(notification.type).toBe("order");

        // ...and the push is durable work waiting in the queue.
        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.pending);
        expect(job.tokens.sort()).toEqual([android, ios].sort());
        expect(job.title).toBe("Order shipped");
        expect((job.data as Record<string, unknown>).orderCode).toBe("SOHO-123");

        // Nothing has touched Expo yet — a provider outage cannot lose this.
        expect(expo.sendCalls).toHaveLength(0);

        await worker.runOnce();
        expect(expo.sentMessages.map((m) => m.to).sort()).toEqual([android, ios].sort());
    });

    it("carries the unread count as an iOS badge for a single-device user", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");

        await notifications.createForUser({ userId: user.id, title: "One", body: "b" });
        expect((await db().pushJob.findFirstOrThrow()).badge).toBe(1);

        await notifications.createForUser({ userId: user.id, title: "Two", body: "b" });
        const jobs = await db().pushJob.findMany({ orderBy: { createdAt: "asc" } });
        expect(jobs[1]?.badge).toBe(2);
    });

    it("still records the notification when the user has no devices", async () => {
        const user = await createUser();

        const created = await notifications.createForUser({
            userId: user.id,
            title: "No devices",
            body: "b",
        });

        expect(created).not.toBeNull();
        expect(await db().notification.count()).toBe(1);
        expect(await db().pushJob.count()).toBe(0);
    });

    it("leaves no notification behind if queueing the push fails", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");

        // A push token row referencing a user that no longer exists is impossible,
        // so force the failure the transaction is meant to guard: drop the user
        // mid-flight by pointing the notification at a missing id.
        const orphan = await notifications.createForUser({
            userId: "00000000-0000-0000-0000-000000000000",
            title: "Orphan",
            body: "b",
        });

        expect(orphan).toBeNull();
        expect(await db().notification.count()).toBe(0);
        expect(await db().pushJob.count()).toBe(0);
    });
});

describe("admin broadcast", () => {
    it("returns as soon as the work is queued and reports the device reach", async () => {
        const targets = [];
        for (let i = 0; i < 3; i++) {
            const user = await createUser({ region: "Dhaka" });
            await addDevice(user.id, "android", `bcast-${i}`);
            targets.push(user);
        }
        // A customer with no device still gets the in-app notification.
        await createUser({ region: "Dhaka" });

        const result = await notifications.adminSend({
            title: "  Eid sale  ",
            body: "  Up to 60% off  ",
            audience: "all",
        });

        expect(result.recipients).toBe(4);
        expect(result.sent).toBe(4);
        expect(result.push).toMatchObject({ queued: true, devices: 3, jobs: 1 });
        expect(expo.sendCalls).toHaveLength(0);

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.title).toBe("Eid sale");
        expect(job.body).toBe("Up to 60% off");
        expect(job.dispatchId).toBe(result.push.dispatchId);

        await worker.runOnce();
        expect(expo.sentMessages).toHaveLength(3);
    });

    it("targets a region without queueing anything for the rest", async () => {
        const dhaka = await createUser({ region: "Dhaka" });
        const dhakaToken = await addDevice(dhaka.id, "ios");
        const ctg = await createUser({ region: "Chattogram" });
        await addDevice(ctg.id, "ios");

        const result = await notifications.adminSend({
            title: "Dhaka only",
            body: "b",
            audience: "region",
            regions: ["dhaka"],
        });

        expect(result.recipients).toBe(1);
        expect((await db().pushJob.findFirstOrThrow()).tokens).toEqual([dhakaToken]);
    });

    it("writes in-app notifications only when push is switched off", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");

        const result = await notifications.adminSend({
            title: "Quiet",
            body: "b",
            pushEnabled: false,
        });

        expect(result.sent).toBe(1);
        expect(result.push).toMatchObject({ queued: false, devices: 0 });
        expect(await db().pushJob.count()).toBe(0);
    });

    it("splits a large broadcast into independently retryable chunks", async () => {
        const user = await createUser();
        for (let i = 0; i < 120; i++) await addDevice(user.id, "android", `big-${i}`);

        const result = await notifications.adminSend({ title: "Big", body: "b" });

        expect(result.push.jobs).toBe(2);

        // One chunk fails; the other must still deliver.
        expo.sendQueue = [new Error("Expo 503")];
        await worker.runOnce();

        const jobs = await db().pushJob.findMany({ orderBy: { status: "asc" } });
        const statuses = jobs.map((j) => j.status).sort();
        expect(statuses).toEqual(
            [PushJobStatus.awaiting_receipt, PushJobStatus.pending].sort()
        );
    });
});

describe("worker", () => {
    it("summarises what it did", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await queue.enqueue({ userIds: [user.id], title: "x", body: "b" });

        const result = await worker.runOnce();

        expect(result).toMatchObject({ claimed: 1, sent: 1, lockedOut: false });
    });

    it("reports an empty sweep without claiming anything", async () => {
        expect(await worker.runOnce()).toMatchObject({ claimed: 0, lockedOut: false });
    });

    it("carries a job from queued through to confirmed delivery", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "android");
        await queue.enqueue({ userIds: [user.id], title: "x", body: "b" });

        expect(await worker.runOnce()).toMatchObject({ sent: 1 });

        await db().pushJob.updateMany({ data: { receiptCheckAt: new Date(Date.now() - 1000) } });
        expo.receipts = { "ticket-1": { status: "ok" } };

        expect(await worker.runOnce()).toMatchObject({ delivered: 1 });

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.succeeded);
        expect(job.delivered).toBe(1);
        expect(
            (await db().pushToken.findUniqueOrThrow({ where: { token } })).lastSuccessAt
        ).not.toBeNull();
    });

    it("keeps a bad job from stopping the rest of the batch", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios", "a");
        await queue.enqueue({ userIds: [user.id], title: "one", body: "b" });
        await queue.enqueue({ userIds: [user.id], title: "two", body: "b" });

        expo.sendQueue = [new Error("first one blew up")];

        const result = await worker.runOnce();

        expect(result.claimed).toBe(2);
        expect(result.retrying).toBe(1);
        expect(result.sent).toBe(1);
    });
});
