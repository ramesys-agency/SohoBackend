import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PushJobStatus } from "@prisma/client";
import { prisma } from "../../../config/prisma.js";
import { PushJobService, type PushTicketRecord } from "../push-job.service.js";
import { FakeExpo, addDevice, createUser, pushToken, resetDatabase } from "./helpers.js";

const db = () => prisma.getClient();

let expo: FakeExpo;
let service: PushJobService;

beforeAll(async () => {
    await prisma.connect();
});

afterAll(async () => {
    await prisma.disconnect();
});

beforeEach(async () => {
    await resetDatabase();
    expo = new FakeExpo();
    service = new PushJobService(expo.asExpo());
});

/** Claim the queue and run every job, the way the worker does. */
async function drain(batchSize = 50) {
    const jobs = await service.claimDueJobs(batchSize);
    const outcomes: string[] = [];
    for (const job of jobs) outcomes.push(await service.processJob(job));
    return outcomes;
}

describe("enqueue", () => {
    it("queues one job per Expo chunk of 100 devices", async () => {
        const user = await createUser();
        for (let i = 0; i < 250; i++) await addDevice(user.id, "android", `dev-${i}`);

        const result = await service.enqueue({
            userIds: [user.id],
            title: "Flash sale",
            body: "50% off today",
        });

        expect(result.tokens).toBe(250);
        expect(result.jobs).toBe(3);

        const jobs = await db().pushJob.findMany({ where: { dispatchId: result.dispatchId } });
        expect(jobs.map((j) => j.tokens.length).sort((a, b) => b - a)).toEqual([100, 100, 50]);
        // Every device is covered exactly once.
        expect(new Set(jobs.flatMap((j) => j.tokens)).size).toBe(250);
    });

    it("creates nothing when the recipients have no devices", async () => {
        const user = await createUser();

        const result = await service.enqueue({ userIds: [user.id], title: "Hi", body: "There" });

        expect(result).toMatchObject({ jobs: 0, tokens: 0 });
        expect(await db().pushJob.count()).toBe(0);
    });

    it("drops malformed tokens instead of queueing a job that can never deliver", async () => {
        const user = await createUser();
        const good = await addDevice(user.id, "ios");
        await db().pushToken.create({
            data: { userId: user.id, token: "not-an-expo-token", platform: "android" },
        });

        const result = await service.enqueue({ userIds: [user.id], title: "Hi", body: "There" });

        expect(result.tokens).toBe(1);
        const job = await db().pushJob.findFirstOrThrow();
        expect(job.tokens).toEqual([good]);
    });

    it("rolls back with the caller's transaction", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");

        await expect(
            db().$transaction(async (tx) => {
                await service.enqueue({ tx, userIds: [user.id], title: "Hi", body: "There" });
                throw new Error("caller failed after enqueue");
            })
        ).rejects.toThrow("caller failed after enqueue");

        expect(await db().pushJob.count()).toBe(0);
    });

    it("applies a badge only when there is a single device to badge", async () => {
        const solo = await createUser();
        await addDevice(solo.id, "ios");
        await service.enqueue({ userIds: [solo.id], title: "A", body: "B", badge: 7 });

        const many = await createUser();
        await addDevice(many.id, "ios");
        await addDevice(many.id, "android");
        await service.enqueue({ userIds: [many.id], title: "A", body: "B", badge: 7 });

        const [soloJob, manyJob] = await db().pushJob.findMany({ orderBy: { createdAt: "asc" } });
        expect(soloJob?.badge).toBe(7);
        expect(manyJob?.badge).toBeNull();
    });
});

describe("claiming", () => {
    it("never hands the same job to two workers", async () => {
        const user = await createUser();
        for (let i = 0; i < 20; i++) await addDevice(user.id, "android", `race-${i}`);
        // 20 devices in one chunk — split them into separate jobs to race on.
        for (let i = 0; i < 5; i++) {
            await service.enqueue({ userIds: [user.id], title: `n${i}`, body: "b" });
        }

        const workerA = new PushJobService(expo.asExpo());
        const workerB = new PushJobService(expo.asExpo());

        const [a, b] = await Promise.all([workerA.claimDueJobs(50), workerB.claimDueJobs(50)]);

        const ids = [...a.map((j) => j.id), ...b.map((j) => j.id)];
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(5);
    });

    it("never hands the same receipt poll to two workers", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        for (let i = 0; i < 5; i++) {
            await service.enqueue({ userIds: [user.id], title: `n${i}`, body: "b" });
        }
        await drain();
        await db().pushJob.updateMany({
            data: { receiptCheckAt: new Date(Date.now() - 1000), lockedAt: null, lockedBy: null },
        });

        // Unlike a send, a receipt poll has no status change to claim with — a
        // double claim here would re-run the follow-up push for the same devices.
        const [a, b] = await Promise.all([
            new PushJobService(expo.asExpo()).claimDueJobs(50),
            new PushJobService(expo.asExpo()).claimDueJobs(50),
        ]);

        const ids = [...a.map((j) => j.id), ...b.map((j) => j.id)];
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(5);
    });

    it("does not re-claim a receipt poll another worker is holding", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });
        await drain();
        await db().pushJob.updateMany({ data: { receiptCheckAt: new Date(Date.now() - 1000) } });

        expect(await service.claimDueJobs(10)).toHaveLength(1);
        expect(await service.claimDueJobs(10)).toHaveLength(0);

        // ...until the holder is long enough gone to be presumed dead.
        await db().pushJob.updateMany({
            data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
        });
        expect(await service.claimDueJobs(10)).toHaveLength(1);
    });

    it("leaves jobs whose retry is still in the future", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "later", body: "b" });

        await db().pushJob.updateMany({ data: { nextRunAt: new Date(Date.now() + 60_000) } });

        expect(await service.claimDueJobs(10)).toHaveLength(0);
    });

    it("claims a receipt poll only once its delay has elapsed", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });
        await drain();

        expect(await service.claimDueJobs(10)).toHaveLength(0);

        await db().pushJob.updateMany({ data: { receiptCheckAt: new Date(Date.now() - 1000) } });
        expect(await service.claimDueJobs(10)).toHaveLength(1);
    });

    it("hands back a job whose worker died mid-send", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await service.claimDueJobs(10);
        expect(await service.claimDueJobs(10)).toHaveLength(0);

        await db().pushJob.updateMany({
            data: { lockedAt: new Date(Date.now() - 60 * 60 * 1000) },
        });

        expect(await service.requeueStaleClaims()).toBe(1);
        expect(await service.claimDueJobs(10)).toHaveLength(1);
    });
});

describe("send phase", () => {
    it("sends the delivery hints both platforms need", async () => {
        const user = await createUser();
        const ios = await addDevice(user.id, "ios");
        const android = await addDevice(user.id, "android");

        await service.enqueue({
            userIds: [user.id],
            title: "Order shipped",
            body: "On its way",
            data: { screen: "orders" },
        });
        await drain();

        const messages = expo.sentMessages;
        expect(messages).toHaveLength(2);
        expect(messages.map((m) => m.to).sort()).toEqual([android, ios].sort());

        for (const message of messages) {
            // Wakes Android out of doze; apns-priority 10 on iOS.
            expect(message.priority).toBe("high");
            // Must match the channel the app registers, or Android 8+ silences it.
            expect(message.channelId).toBe("default");
            // Lets Expo/FCM/APNs hold the push for a device that is offline now.
            expect(message.ttl).toBe(604800);
            expect(message.sound).toBe("default");
            expect(message.title).toBe("Order shipped");
            expect(message.data).toEqual({ screen: "orders" });
        }
    });

    it("moves to awaiting_receipt and remembers which ticket belongs to which device", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        expect(await drain()).toEqual(["sent"]);

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.awaiting_receipt);
        expect(job.receiptCheckAt).not.toBeNull();
        expect(job.tickets as unknown as PushTicketRecord[]).toEqual([
            { token, ticketId: "ticket-1" },
        ]);
    });

    it("does not push to a device that was unregistered after queueing", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        // The user logs out between enqueue and delivery.
        await db().pushToken.delete({ where: { token } });

        expect(await drain()).toEqual(["skipped"]);
        expect(expo.sendCalls).toHaveLength(0);
        expect((await db().pushJob.findFirstOrThrow()).status).toBe(PushJobStatus.cancelled);
    });

    it("retries with backoff when the Expo request fails outright", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        expo.sendQueue = [new Error("socket hang up")];
        const before = Date.now();

        expect(await drain()).toEqual(["retrying"]);

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.pending);
        expect(job.attempts).toBe(1);
        expect(job.lastError).toContain("socket hang up");
        // First configured delay is 1 minute.
        expect(job.nextRunAt.getTime()).toBeGreaterThan(before + 50_000);
    });

    it("gives up after the configured attempts are spent", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        // 1 immediate attempt + 3 configured retries.
        for (let i = 0; i < 4; i++) {
            expo.sendQueue = [new Error(`attempt ${i} failed`)];
            await db().pushJob.updateMany({ data: { nextRunAt: new Date(Date.now() - 1000) } });
            await drain();
        }

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.exhausted);
        expect(job.attempts).toBe(4);
        expect(job.failed).toBe(1);
    });

    it("prunes a device Expo rejects as unregistered at ticket time", async () => {
        const user = await createUser();
        const dead = await addDevice(user.id, "android");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        expo.sendQueue = [
            [
                {
                    status: "error",
                    message: "not registered",
                    details: { error: "DeviceNotRegistered" },
                },
            ],
        ];

        expect(await drain()).toEqual(["skipped"]);

        expect(await db().pushToken.findUnique({ where: { token: dead } })).toBeNull();
        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.succeeded);
        expect(job.delivered).toBe(0);
        expect(job.failed).toBe(1);
    });

    it("re-queues only the rate-limited devices when part of a chunk is accepted", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios", "keep-1");
        await addDevice(user.id, "android", "limited-1");
        const { dispatchId } = await service.enqueue({
            userIds: [user.id],
            title: "x",
            body: "b",
        });

        const job = await db().pushJob.findFirstOrThrow();
        const [first, second] = job.tokens as [string, string];

        expo.sendQueue = [
            [
                { status: "ok", id: "ticket-a" },
                {
                    status: "error",
                    message: "slow down",
                    details: { error: "MessageRateExceeded" },
                },
            ],
        ];

        await drain();

        const jobs = await db().pushJob.findMany({
            where: { dispatchId },
            orderBy: { createdAt: "asc" },
        });
        expect(jobs).toHaveLength(2);

        // The original keeps only the accepted ticket.
        expect(jobs[0]?.status).toBe(PushJobStatus.awaiting_receipt);
        expect(jobs[0]?.tickets as unknown as PushTicketRecord[]).toEqual([
            { token: first, ticketId: "ticket-a" },
        ]);

        // The follow-up carries only the rejected device, scheduled for later.
        expect(jobs[1]?.status).toBe(PushJobStatus.pending);
        expect(jobs[1]?.tokens).toEqual([second]);
        expect(jobs[1]?.attempts).toBe(1);
        expect(jobs[1]!.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    });
});

describe("receipt phase", () => {
    async function sendThenMakeReceiptsDue() {
        await drain();
        await db().pushJob.updateMany({ data: { receiptCheckAt: new Date(Date.now() - 1000) } });
    }

    it("records delivery and marks the device healthy", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receipts = { "ticket-1": { status: "ok" } };

        expect(await drain()).toEqual(["delivered"]);

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.succeeded);
        expect(job.delivered).toBe(1);

        const device = await db().pushToken.findUniqueOrThrow({ where: { token } });
        expect(device.lastSuccessAt).not.toBeNull();
        expect(device.failureCount).toBe(0);
    });

    it("prunes a device that reports DeviceNotRegistered in its receipt", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "android");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receipts = {
            "ticket-1": {
                status: "error",
                message: "device not registered",
                details: { error: "DeviceNotRegistered" },
            },
        };

        await drain();

        expect(await db().pushToken.findUnique({ where: { token } })).toBeNull();
        const job = await db().pushJob.findFirstOrThrow();
        expect(job.delivered).toBe(0);
        expect(job.failed).toBe(1);
        expect(job.lastError).toContain("DeviceNotRegistered");
    });

    it("keeps the device but flags it when the push credentials are the problem", async () => {
        const user = await createUser();
        const token = await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receipts = {
            "ticket-1": {
                status: "error",
                message: "Could not find APNs credentials",
                details: { error: "InvalidCredentials" },
            },
        };

        await drain();

        // An expired APNs key is a server problem — throwing away every iOS
        // token would turn a fixable outage into permanent data loss.
        const device = await db().pushToken.findUniqueOrThrow({ where: { token } });
        expect(device.failureCount).toBe(1);
        expect(device.lastError).toContain("InvalidCredentials");
        expect(device.lastErrorAt).not.toBeNull();
    });

    it("waits for a receipt Expo has not decided on yet", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receipts = {}; // not ready

        await drain();

        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.awaiting_receipt);
        expect(job.receiptCheckAt!.getTime()).toBeGreaterThan(Date.now() + 10 * 60 * 1000);
    });

    it("does not resend when the receipt lookup itself fails", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receiptError = new Error("Expo receipts unavailable");

        await drain();

        expect(expo.sendCalls).toHaveLength(1);
        const job = await db().pushJob.findFirstOrThrow();
        expect(job.status).toBe(PushJobStatus.awaiting_receipt);
        expect(job.lastError).toContain("Expo receipts unavailable");
    });

    it("stops chasing receipts once Expo's retention window has passed", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        await sendThenMakeReceiptsDue();
        expo.receipts = {};
        await db().pushJob.updateMany({
            data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
        });

        expect(await drain()).toEqual(["delivered"]);
        expect((await db().pushJob.findFirstOrThrow()).status).toBe(PushJobStatus.succeeded);
    });
});

describe("housekeeping", () => {
    it("sweeps finished jobs past the retention window and keeps live ones", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await service.enqueue({ userIds: [user.id], title: "old", body: "b" });
        await service.enqueue({ userIds: [user.id], title: "live", body: "b" });

        const [old] = await db().pushJob.findMany({ orderBy: { createdAt: "asc" } });
        await db().pushJob.update({
            where: { id: old!.id },
            data: {
                status: PushJobStatus.succeeded,
                updatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
        });

        expect(await service.sweepFinishedJobs()).toBe(1);
        expect(await db().pushJob.count()).toBe(1);
    });

    it("reports queue depth and device health per platform", async () => {
        const user = await createUser();
        await addDevice(user.id, "ios");
        await addDevice(user.id, "android");
        await addDevice(user.id, "android");
        await service.enqueue({ userIds: [user.id], title: "x", body: "b" });

        const stats = await service.getStats();

        expect(stats.tokens).toMatchObject({ total: 3, ios: 1, android: 2, unhealthy: 0 });
        expect(stats.queue[PushJobStatus.pending]).toBe(1);
        expect(stats.last24h.dispatched).toBe(1);
    });
});

describe("sendTestNow", () => {
    it("reports Expo's verdict separately for each platform", async () => {
        const user = await createUser();
        const ios = await addDevice(user.id, "ios");
        const android = await addDevice(user.id, "android");

        expo.sendQueue = [
            [
                { status: "ok", id: "ticket-ok" },
                {
                    status: "error",
                    message: "no FCM credentials",
                    details: { error: "InvalidCredentials" },
                },
            ],
        ];

        const result = await service.sendTestNow(user.id);

        expect(result.devices).toBe(2);
        const byToken = Object.fromEntries(result.results.map((r) => [r.token, r]));
        expect(byToken[ios]).toMatchObject({ platform: "ios", status: "ok" });
        expect(byToken[android]).toMatchObject({ platform: "android", status: "error" });
        expect(byToken[android]?.error).toContain("InvalidCredentials");
    });

    it("reports no devices rather than failing when the user has none", async () => {
        const user = await createUser();
        expect(await service.sendTestNow(user.id)).toEqual({ devices: 0, results: [] });
    });

    it("skips malformed tokens", async () => {
        const user = await createUser();
        await db().pushToken.create({
            data: { userId: user.id, token: "garbage", platform: "ios" },
        });
        await db().pushToken.create({
            data: { userId: user.id, token: pushToken("valid"), platform: "android" },
        });

        const result = await service.sendTestNow(user.id);
        expect(result.devices).toBe(1);
        expect(result.results[0]?.platform).toBe("android");
    });
});
