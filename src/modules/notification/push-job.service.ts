import { randomUUID } from "node:crypto";
import { Expo } from "expo-server-sdk";
import type {
    ExpoPushMessage,
    ExpoPushReceipt,
    ExpoPushTicket,
    ExpoPushErrorReceipt,
} from "expo-server-sdk";
import { NotificationType, Prisma, PushJobStatus, type PushJob } from "@prisma/client";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import type { PrismaService } from "../../core/services/index.js";

/** Identifies this process in `lockedBy` so a claim can be traced to an instance. */
const INSTANCE_ID = randomUUID();

/** Expo keeps receipts for roughly a day; after that there is nothing left to poll for. */
const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** What Expo told us about one accepted device, kept so a receipt maps back to a token. */
export interface PushTicketRecord {
    token: string;
    ticketId: string;
}

export type PushJobOutcome = "sent" | "delivered" | "retrying" | "exhausted" | "skipped";

export interface EnqueuePushParams {
    userIds: string[];
    title: string;
    body: string;
    data?: Record<string, unknown> | null;
    type?: NotificationType;
    /** iOS app-icon badge. Only meaningful when there is a single recipient. */
    badge?: number | null;
    ttlSeconds?: number;
    priority?: "default" | "normal" | "high";
    channelId?: string;
    /**
     * Enqueue inside a caller's transaction, so a notification and its delivery
     * job commit together or not at all.
     */
    tx?: Prisma.TransactionClient;
}

export interface EnqueueResult {
    dispatchId: string;
    jobs: number;
    tokens: number;
}

/**
 * Expo errors split into "this device is gone", "our server is misconfigured"
 * and "try again later". Only the last is worth a retry, and only the first
 * should ever cost a user their token.
 */
type ExpoErrorCode = NonNullable<NonNullable<ExpoPushErrorReceipt["details"]>["error"]>;

const RETRYABLE_ERRORS: ReadonlySet<string> = new Set<ExpoErrorCode>([
    "MessageRateExceeded",
    "ExpoError",
    "ProviderError",
]);

const TOKEN_KILLING_ERRORS: ReadonlySet<string> = new Set<ExpoErrorCode>(["DeviceNotRegistered"]);

/**
 * These mean the push credentials themselves are wrong — an expired APNs key, a
 * FCM service account that was never uploaded. Every device on that platform
 * fails identically and silently, which is exactly how "iOS never gets
 * notifications" goes unnoticed for weeks. Never prune tokens for these; shout
 * about them instead.
 */
const CONFIG_ERRORS: ReadonlySet<string> = new Set<ExpoErrorCode>([
    "InvalidCredentials",
    "DeveloperError",
]);

/**
 * The durable queue that delivers push notifications.
 *
 * A row is one Expo chunk. The send phase hands the chunk to Expo and stores the
 * tickets; the receipt phase, minutes later, asks Expo what actually happened and
 * prunes the devices that no longer exist. Both phases are claimed at the
 * database level, so two replicas cannot deliver the same chunk twice and a
 * process that dies mid-send hands its work back instead of dropping it.
 */
export class PushJobService {
    private prisma: PrismaService = prisma;
    private expo: Expo;

    constructor(expoClient?: Expo) {
        this.expo =
            expoClient ??
            new Expo(config.push.accessToken ? { accessToken: config.push.accessToken } : {});
    }

    get retryDelaysMinutes(): number[] {
        return config.push.retryDelaysMinutes;
    }

    /** 1 immediate attempt + one per configured retry delay. */
    get maxAttempts(): number {
        return 1 + this.retryDelaysMinutes.length;
    }

    // --- Queueing ------------------------------------------------------------

    /**
     * Resolve the recipients' devices and queue them as Expo-sized chunks.
     *
     * Returns without creating anything when nobody has a usable device, so an
     * order update for a web-only customer is not a permanently failing job.
     */
    async enqueue(params: EnqueuePushParams): Promise<EnqueueResult> {
        const dispatchId = randomUUID();
        const client = params.tx ?? this.prisma.getClient();

        const userIds = [...new Set(params.userIds.filter(Boolean))];
        if (userIds.length === 0) return { dispatchId, jobs: 0, tokens: 0 };

        const rows = await client.pushToken.findMany({
            where: { userId: { in: userIds } },
            select: { token: true },
        });

        // A malformed token can never be delivered and would burn every retry, so
        // it is dropped here rather than queued.
        const tokens = [
            ...new Set(rows.map((r: { token: string }) => r.token).filter((t: string) => Expo.isExpoPushToken(t))),
        ];

        if (tokens.length === 0) return { dispatchId, jobs: 0, tokens: 0 };

        const chunkSize = Expo.pushNotificationChunkSizeLimit;
        const chunks: string[][] = [];
        for (let i = 0; i < tokens.length; i += chunkSize) {
            chunks.push(tokens.slice(i, i + chunkSize));
        }

        await client.pushJob.createMany({
            data: chunks.map((chunk) => ({
                dispatchId,
                type: params.type ?? NotificationType.general,
                title: params.title,
                body: params.body,
                ...(params.data != null ? { data: params.data as Prisma.InputJsonValue } : {}),
                tokens: chunk,
                priority: params.priority ?? "high",
                ttlSeconds: params.ttlSeconds ?? config.push.ttlSeconds,
                channelId: params.channelId ?? "default",
                // A badge is a per-user number; on a multi-device broadcast chunk
                // it would be wrong for everyone but the first recipient.
                ...(params.badge != null && tokens.length === 1 ? { badge: params.badge } : {}),
                maxAttempts: this.maxAttempts,
                nextRunAt: new Date(),
            })),
        });

        return { dispatchId, jobs: chunks.length, tokens: tokens.length };
    }

    // --- Claiming ------------------------------------------------------------

    /**
     * Hand back jobs claimed by a process that then died. Without this a crash
     * mid-send would strand a notification in `processing` forever.
     */
    async requeueStaleClaims(): Promise<number> {
        const cutoff = new Date(Date.now() - config.push.staleClaimMinutes * 60 * 1000);

        const { count } = await this.prisma.getClient().pushJob.updateMany({
            where: { status: PushJobStatus.processing, lockedAt: { lt: cutoff } },
            data: { status: PushJobStatus.pending, lockedBy: null, lockedAt: null },
        });

        if (count) logger.warn("Requeued stale push job claims", { count });

        return count;
    }

    /**
     * Atomically take ownership of up to `batchSize` jobs that are due — either
     * a first/retry send, or a receipt poll whose delay has elapsed.
     *
     * The status guard inside the update is the actual claim: two workers racing
     * on the same rows cannot both win it, with or without Redis.
     */
    async claimDueJobs(batchSize: number): Promise<PushJob[]> {
        const client = this.prisma.getClient();
        const lockedBy = `${INSTANCE_ID}:${randomUUID()}`;
        const now = new Date();
        const staleCutoff = new Date(now.getTime() - config.push.staleClaimMinutes * 60 * 1000);

        // A receipt poll stays in `awaiting_receipt` while it runs, so unlike a
        // send it has no status transition to claim with. `lockedAt` is the guard
        // instead: free, or abandoned long enough to be reclaimed.
        const unclaimed = {
            OR: [{ lockedAt: null }, { lockedAt: { lt: staleCutoff } }],
        };

        const due = await client.pushJob.findMany({
            where: {
                OR: [
                    { status: PushJobStatus.pending, nextRunAt: { lte: now } },
                    {
                        status: PushJobStatus.awaiting_receipt,
                        receiptCheckAt: { lte: now },
                        ...unclaimed,
                    },
                ],
            },
            orderBy: { nextRunAt: "asc" },
            take: batchSize,
            select: { id: true, status: true },
        });

        if (!due.length) return [];

        // Claimed per source status so a job that changed state between the read
        // and the update is left alone rather than yanked out of its phase.
        const pendingIds = due.filter((j) => j.status === PushJobStatus.pending).map((j) => j.id);
        const receiptIds = due
            .filter((j) => j.status === PushJobStatus.awaiting_receipt)
            .map((j) => j.id);

        let claimed = 0;

        if (pendingIds.length) {
            // The `status: pending` guard inside the update is the actual claim:
            // two workers racing on the same rows cannot both win it.
            const { count } = await client.pushJob.updateMany({
                where: { id: { in: pendingIds }, status: PushJobStatus.pending },
                data: { status: PushJobStatus.processing, lockedAt: now, lockedBy },
            });
            claimed += count;
        }

        if (receiptIds.length) {
            const { count } = await client.pushJob.updateMany({
                where: {
                    id: { in: receiptIds },
                    status: PushJobStatus.awaiting_receipt,
                    ...unclaimed,
                },
                data: { lockedAt: now, lockedBy },
            });
            claimed += count;
        }

        if (!claimed) return [];

        return await client.pushJob.findMany({ where: { lockedBy } });
    }

    // --- Processing ----------------------------------------------------------

    async processJob(job: PushJob): Promise<PushJobOutcome> {
        return job.status === PushJobStatus.awaiting_receipt
            ? await this.pollReceipts(job)
            : await this.sendChunk(job);
    }

    /** Phase 1 — hand the chunk to Expo and remember the tickets. */
    private async sendChunk(job: PushJob): Promise<PushJobOutcome> {
        const client = this.prisma.getClient();

        // Re-read the devices: a user who logged out between enqueue and now must
        // not receive their order updates on a device they signed off.
        const live = await client.pushToken.findMany({
            where: { token: { in: job.tokens } },
            select: { token: true },
        });
        const liveTokens = live.map((t: { token: string }) => t.token);

        if (liveTokens.length === 0) {
            await client.pushJob.update({
                where: { id: job.id },
                data: {
                    status: PushJobStatus.cancelled,
                    lastError: "Every target device was unregistered before delivery",
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            return "skipped";
        }

        const messages: ExpoPushMessage[] = liveTokens.map((token: string) => ({
            to: token,
            title: job.title,
            body: job.body,
            data: (job.data ?? {}) as Record<string, unknown>,
            sound: "default",
            // Android: wakes the device out of doze instead of waiting for the
            // next maintenance window. iOS: maps to apns-priority 10.
            priority: (job.priority as "default" | "normal" | "high") ?? "high",
            // How long Expo/FCM/APNs hold the message for a device that is
            // offline right now. Without it a phone with mobile data off can miss
            // the notification entirely.
            ttl: job.ttlSeconds,
            // Must match the channel the app creates at startup, or Android 8+
            // drops it into a silent default channel with no heads-up display.
            channelId: job.channelId,
            ...(job.badge != null ? { badge: job.badge } : {}),
        }));

        let tickets: ExpoPushTicket[];
        try {
            tickets = await this.expo.sendPushNotificationsAsync(messages);
        } catch (error) {
            // The whole request failed (network, 5xx, rate limit). Nothing was
            // delivered, so the entire chunk is retried.
            return await this.recordFailure(job, error instanceof Error ? error.message : String(error));
        }

        const accepted: PushTicketRecord[] = [];
        const deadTokens: string[] = [];
        const retryTokens: string[] = [];
        const errorsByCode = new Map<string, { tokens: string[]; message: string }>();

        tickets.forEach((ticket, index) => {
            const token = liveTokens[index] as string;

            if (ticket.status === "ok") {
                accepted.push({ token, ticketId: ticket.id });
                return;
            }

            const code = ticket.details?.error ?? "Unknown";
            const bucket = errorsByCode.get(code) ?? { tokens: [], message: ticket.message };
            bucket.tokens.push(token);
            errorsByCode.set(code, bucket);

            if (TOKEN_KILLING_ERRORS.has(code)) deadTokens.push(token);
            else if (RETRYABLE_ERRORS.has(code)) retryTokens.push(token);
        });

        await this.applyTokenOutcomes({ deadTokens, errorsByCode });

        // Everything Expo rejected is retryable — treat it as a failed attempt so
        // the backoff applies, rather than burning the tokens.
        if (accepted.length === 0 && retryTokens.length > 0) {
            const [code, bucket] = [...errorsByCode.entries()][0] ?? ["Unknown", { message: "" }];
            return await this.recordFailure(job, `${code}: ${bucket.message}`, retryTokens);
        }

        if (accepted.length === 0) {
            // Nothing accepted and nothing worth retrying — the devices are gone
            // or the message is permanently unsendable.
            const summary = [...errorsByCode.entries()]
                .map(([code, b]) => `${code} x${b.tokens.length}`)
                .join(", ");

            await client.pushJob.update({
                where: { id: job.id },
                data: {
                    status: PushJobStatus.succeeded,
                    attempts: job.attempts + 1,
                    lastAttempt: new Date(),
                    lastError: summary || "No device accepted the notification",
                    failed: liveTokens.length,
                    delivered: 0,
                    lockedAt: null,
                    lockedBy: null,
                },
            });
            return "skipped";
        }

        // Some devices were rejected for a retryable reason while others were
        // accepted — re-queue only the rejected ones as their own job so the
        // accepted tickets are not re-sent.
        if (retryTokens.length > 0) {
            await this.requeueTokens(job, retryTokens);
        }

        await client.pushJob.update({
            where: { id: job.id },
            data: {
                status: PushJobStatus.awaiting_receipt,
                attempts: job.attempts + 1,
                lastAttempt: new Date(),
                lastError: null,
                tickets: accepted as unknown as Prisma.InputJsonValue,
                receiptCheckAt: new Date(Date.now() + config.push.receiptDelayMinutes * 60 * 1000),
                failed: liveTokens.length - accepted.length,
                lockedAt: null,
                lockedBy: null,
            },
        });

        return "sent";
    }

    /**
     * Phase 2 — ask Expo what actually happened.
     *
     * A ticket only means Expo took the message; whether APNs or FCM accepted it
     * is only knowable here. This is the only place a dead token is discovered,
     * so skipping it means pushing to uninstalled apps forever.
     */
    private async pollReceipts(job: PushJob): Promise<PushJobOutcome> {
        const client = this.prisma.getClient();
        const records = (job.tickets as unknown as PushTicketRecord[] | null) ?? [];

        if (records.length === 0) {
            await client.pushJob.update({
                where: { id: job.id },
                data: { status: PushJobStatus.succeeded, lockedAt: null, lockedBy: null },
            });
            return "delivered";
        }

        const receipts: Record<string, ExpoPushReceipt> = {};
        try {
            for (const chunk of this.expo.chunkPushNotificationReceiptIds(
                records.map((r) => r.ticketId)
            )) {
                Object.assign(receipts, await this.expo.getPushNotificationReceiptsAsync(chunk));
            }
        } catch (error) {
            // Receipts are advisory — a failure to read them must not resend a
            // notification that was already delivered. Just look again later.
            return await this.rescheduleReceiptCheck(
                job,
                error instanceof Error ? error.message : String(error)
            );
        }

        const okTokens: string[] = [];
        const deadTokens: string[] = [];
        const retryTokens: string[] = [];
        const errorsByCode = new Map<string, { tokens: string[]; message: string }>();
        let pending = 0;

        for (const record of records) {
            const receipt = receipts[record.ticketId];

            // Expo has not decided yet — leave this device for the next poll.
            if (!receipt) {
                pending++;
                continue;
            }

            if (receipt.status === "ok") {
                okTokens.push(record.token);
                continue;
            }

            const code = receipt.details?.error ?? "Unknown";
            const bucket = errorsByCode.get(code) ?? { tokens: [], message: receipt.message };
            bucket.tokens.push(record.token);
            errorsByCode.set(code, bucket);

            if (TOKEN_KILLING_ERRORS.has(code)) deadTokens.push(record.token);
            else if (RETRYABLE_ERRORS.has(code)) retryTokens.push(record.token);
        }

        await this.applyTokenOutcomes({ okTokens, deadTokens, errorsByCode });

        if (retryTokens.length > 0) await this.requeueTokens(job, retryTokens);

        // Still waiting on some devices, and receipts are still within Expo's
        // retention window — come back for them.
        if (pending > 0 && Date.now() - job.createdAt.getTime() < RECEIPT_WINDOW_MS) {
            return await this.rescheduleReceiptCheck(job, null, okTokens.length);
        }

        const summary = [...errorsByCode.entries()]
            .map(([code, b]) => `${code} x${b.tokens.length}`)
            .join(", ");

        // `job.failed` already counts the devices Expo rejected at ticket time;
        // add the ones that failed later, in the receipt.
        const failedNow = records.length - okTokens.length - pending;

        await client.pushJob.update({
            where: { id: job.id },
            data: {
                status: PushJobStatus.succeeded,
                delivered: okTokens.length,
                failed: job.failed + failedNow,
                ...(summary ? { lastError: summary } : {}),
                lockedAt: null,
                lockedBy: null,
            },
        });

        logger.info("Push delivery confirmed", {
            jobId: job.id,
            dispatchId: job.dispatchId,
            delivered: okTokens.length,
            failed: failedNow,
            undetermined: pending,
        });

        return "delivered";
    }

    private async rescheduleReceiptCheck(
        job: PushJob,
        error: string | null,
        delivered?: number
    ): Promise<PushJobOutcome> {
        await this.prisma.getClient().pushJob.update({
            where: { id: job.id },
            data: {
                status: PushJobStatus.awaiting_receipt,
                receiptCheckAt: new Date(Date.now() + config.push.receiptDelayMinutes * 60 * 1000),
                ...(error ? { lastError: error.slice(0, 500) } : {}),
                ...(delivered != null ? { delivered } : {}),
                lockedAt: null,
                lockedBy: null,
            },
        });
        return "sent";
    }

    /**
     * Split the devices that deserve another attempt into their own job, so a
     * rate-limited handful does not re-notify everyone the chunk already reached.
     */
    private async requeueTokens(job: PushJob, tokens: string[]): Promise<void> {
        if (job.attempts + 1 >= job.maxAttempts) return;

        const delayMinutes = this.retryDelaysMinutes[job.attempts] ?? this.retryDelaysMinutes.at(-1) ?? 5;

        await this.prisma.getClient().pushJob.create({
            data: {
                dispatchId: job.dispatchId,
                type: job.type,
                title: job.title,
                body: job.body,
                ...(job.data != null ? { data: job.data as Prisma.InputJsonValue } : {}),
                tokens,
                priority: job.priority,
                ttlSeconds: job.ttlSeconds,
                channelId: job.channelId,
                ...(job.badge != null ? { badge: job.badge } : {}),
                attempts: job.attempts + 1,
                maxAttempts: job.maxAttempts,
                nextRunAt: new Date(Date.now() + delayMinutes * 60 * 1000),
            },
        });
    }

    /** Record what each device told us: prune the gone, mark the broken, credit the delivered. */
    private async applyTokenOutcomes(params: {
        okTokens?: string[];
        deadTokens: string[];
        errorsByCode: Map<string, { tokens: string[]; message: string }>;
    }): Promise<void> {
        const client = this.prisma.getClient();

        if (params.okTokens?.length) {
            await client.pushToken.updateMany({
                where: { token: { in: params.okTokens } },
                data: { lastSuccessAt: new Date(), failureCount: 0, lastError: null },
            });
        }

        if (params.deadTokens.length) {
            const { count } = await client.pushToken.deleteMany({
                where: { token: { in: params.deadTokens } },
            });
            logger.info("Pruned push tokens for uninstalled or reset devices", { count });
        }

        for (const [code, bucket] of params.errorsByCode) {
            if (TOKEN_KILLING_ERRORS.has(code)) continue;

            const survivors = bucket.tokens.filter((t) => !params.deadTokens.includes(t));
            if (!survivors.length) continue;

            await client.pushToken.updateMany({
                where: { token: { in: survivors } },
                data: {
                    lastErrorAt: new Date(),
                    lastError: `${code}: ${bucket.message}`.slice(0, 500),
                    failureCount: { increment: 1 },
                },
            });

            if (CONFIG_ERRORS.has(code)) {
                // Not a device problem. Every push to this platform is failing.
                const platforms = await client.pushToken.findMany({
                    where: { token: { in: survivors } },
                    select: { platform: true },
                    distinct: ["platform"],
                });

                logger.error(
                    "Push credentials rejected by the provider — notifications are not being delivered",
                    {
                        code,
                        message: bucket.message,
                        affectedTokens: survivors.length,
                        platforms: platforms.map((p: { platform: string }) => p.platform),
                        hint: "Check the APNs key (iOS) / FCM v1 service account (Android) uploaded to the Expo project",
                    }
                );
            }
        }
    }

    private async recordFailure(
        job: PushJob,
        message: string,
        onlyTokens?: string[]
    ): Promise<PushJobOutcome> {
        const attempts = job.attempts + 1;
        const truncated = message.slice(0, 500);
        const delayMinutes = this.retryDelaysMinutes[attempts - 1];

        if (attempts >= job.maxAttempts || delayMinutes === undefined) {
            await this.prisma.getClient().pushJob.update({
                where: { id: job.id },
                data: {
                    status: PushJobStatus.exhausted,
                    attempts,
                    lastAttempt: new Date(),
                    lastError: truncated,
                    failed: job.tokens.length,
                    lockedAt: null,
                    lockedBy: null,
                },
            });

            logger.error("Push notification gave up after every retry", {
                jobId: job.id,
                dispatchId: job.dispatchId,
                devices: job.tokens.length,
                attempts,
                error: truncated,
            });

            return "exhausted";
        }

        await this.prisma.getClient().pushJob.update({
            where: { id: job.id },
            data: {
                status: PushJobStatus.pending,
                attempts,
                nextRunAt: new Date(Date.now() + delayMinutes * 60 * 1000),
                lastAttempt: new Date(),
                lastError: truncated,
                ...(onlyTokens ? { tokens: onlyTokens } : {}),
                lockedAt: null,
                lockedBy: null,
            },
        });

        logger.warn("Push delivery attempt failed — retry scheduled", {
            jobId: job.id,
            attempt: attempts,
            maxAttempts: job.maxAttempts,
            retryInMinutes: delayMinutes,
            error: truncated,
        });

        return "retrying";
    }

    // --- Housekeeping ---------------------------------------------------------

    /** Drop finished jobs once they are past the audit window. */
    async sweepFinishedJobs(): Promise<number> {
        const cutoff = new Date(Date.now() - config.push.retentionDays * 24 * 60 * 60 * 1000);

        const { count } = await this.prisma.getClient().pushJob.deleteMany({
            where: {
                status: {
                    in: [PushJobStatus.succeeded, PushJobStatus.exhausted, PushJobStatus.cancelled],
                },
                updatedAt: { lt: cutoff },
            },
        });

        return count;
    }

    /**
     * Send straight to a user's devices, bypassing the queue, and report what
     * Expo said about each one.
     *
     * This is the diagnostic that answers "why does nothing arrive on iOS" —
     * a bad APNs key or a missing FCM service account shows up here as an
     * immediate per-platform error instead of silence.
     */
    async sendTestNow(
        userId: string,
        title = "Soho test notification",
        body = "If you can read this, push delivery is working on this device."
    ): Promise<{
        devices: number;
        results: {
            platform: string;
            token: string;
            status: "ok" | "error";
            ticketId?: string;
            error?: string;
        }[];
    }> {
        const devices = await this.prisma.getClient().pushToken.findMany({
            where: { userId },
            select: { token: true, platform: true },
        });

        const valid = devices.filter((d: { token: string }) => Expo.isExpoPushToken(d.token));
        if (valid.length === 0) return { devices: 0, results: [] };

        const results: {
            platform: string;
            token: string;
            status: "ok" | "error";
            ticketId?: string;
            error?: string;
        }[] = [];

        const messages: ExpoPushMessage[] = valid.map((d: { token: string }) => ({
            to: d.token,
            title,
            body,
            data: { screen: "notifications", test: true },
            sound: "default",
            priority: "high",
            ttl: config.push.ttlSeconds,
            channelId: "default",
        }));

        for (const chunk of this.expo.chunkPushNotifications(messages)) {
            const offset = results.length;
            const tickets = await this.expo.sendPushNotificationsAsync(chunk);

            tickets.forEach((ticket, index) => {
                const device = valid[offset + index] as { token: string; platform: string };
                results.push(
                    ticket.status === "ok"
                        ? {
                              platform: device.platform,
                              token: device.token,
                              status: "ok",
                              ticketId: ticket.id,
                          }
                        : {
                              platform: device.platform,
                              token: device.token,
                              status: "error",
                              error: `${ticket.details?.error ?? "Unknown"}: ${ticket.message}`,
                          }
                );
            });
        }

        return { devices: valid.length, results };
    }

    async getStats(): Promise<{
        queue: Record<string, number>;
        last24h: { dispatched: number; delivered: number; failed: number };
        tokens: { total: number; ios: number; android: number; unhealthy: number };
    }> {
        const client = this.prisma.getClient();
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

        const [byStatus, recent, tokenCounts, unhealthy] = await Promise.all([
            client.pushJob.groupBy({ by: ["status"], _count: { _all: true } }),
            client.pushJob.aggregate({
                where: { createdAt: { gte: since } },
                _sum: { delivered: true, failed: true },
                _count: { _all: true },
            }),
            client.pushToken.groupBy({ by: ["platform"], _count: { _all: true } }),
            client.pushToken.count({ where: { failureCount: { gte: 1 } } }),
        ]);

        const queue: Record<string, number> = {};
        for (const row of byStatus as { status: string; _count: { _all: number } }[]) {
            queue[row.status] = row._count._all;
        }

        const platforms: Record<string, number> = {};
        let total = 0;
        for (const row of tokenCounts as { platform: string; _count: { _all: number } }[]) {
            platforms[row.platform] = row._count._all;
            total += row._count._all;
        }

        return {
            queue,
            last24h: {
                dispatched: recent._count._all,
                delivered: recent._sum.delivered ?? 0,
                failed: recent._sum.failed ?? 0,
            },
            tokens: {
                total,
                ios: platforms.ios ?? 0,
                android: platforms.android ?? 0,
                unhealthy,
            },
        };
    }
}

export const pushJobService = new PushJobService();
