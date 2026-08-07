import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { pushJobService, type PushJobService } from "./push-job.service.js";

const LOCK_KEY = "notification:push-job-worker-lock";

/** How often finished jobs are swept, counted in worker ticks. */
const SWEEP_EVERY_TICKS = 240;

export interface PushWorkerResult {
    claimed: number;
    sent: number;
    delivered: number;
    retrying: number;
    exhausted: number;
    skipped: number;
    /** True when another run held the lock and this one was a no-op. */
    lockedOut: boolean;
}

const EMPTY: PushWorkerResult = {
    claimed: 0,
    sent: 0,
    delivered: 0,
    retrying: 0,
    exhausted: 0,
    skipped: 0,
    lockedOut: true,
};

/**
 * Drains the push notification queue.
 *
 * Same shape as LogisticsJobWorker: an in-process interval, a Redis lock so
 * replicas don't double up, and an admin endpoint so an external cron can drive
 * it on hosts that suspend idle processes. Jobs are also claimed at the database
 * level, so correctness does not depend on Redis being available.
 */
export class PushJobWorker {
    private timer?: NodeJS.Timeout | undefined;
    private running = false;
    private ticks = 0;

    constructor(private readonly service: PushJobService = pushJobService) {}

    start(): void {
        if (!config.push.enabled) {
            logger.info("Push job worker is disabled (PUSH_JOB_ENABLED=false)");
            return;
        }

        const intervalMs = config.push.pollIntervalSeconds * 1000;
        logger.info(
            `Push job worker started (Interval: ${config.push.pollIntervalSeconds}s, Retries: ${config.push.retryDelaysMinutes.join("m, ")}m, Receipts: +${config.push.receiptDelayMinutes}m)`
        );

        this.timer = setInterval(() => {
            void this.runOnce().catch((error) => {
                logger.error("Push job sweep failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
            logger.info("Push job worker stopped");
        }
    }

    /**
     * Nudge the queue without waiting for the next tick. Called right after a
     * notification is created so an order update feels immediate instead of
     * arriving up to a poll interval late.
     */
    kick(): void {
        if (!config.push.enabled || this.running) return;

        void this.runOnce().catch((error) => {
            logger.warn("Immediate push drain failed — the scheduled sweep will retry", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    /** Process one batch of due jobs — both first sends/retries and receipt polls. */
    async runOnce(): Promise<PushWorkerResult> {
        if (this.running) return EMPTY;
        if (!(await this.acquireLock())) return EMPTY;

        this.running = true;

        try {
            await this.service.requeueStaleClaims();

            if (++this.ticks % SWEEP_EVERY_TICKS === 0) {
                const swept = await this.service.sweepFinishedJobs();
                if (swept) logger.info("Swept finished push jobs", { count: swept });
            }

            const jobs = await this.service.claimDueJobs(config.push.batchSize);
            if (!jobs.length) return { ...EMPTY, lockedOut: false };

            const result: PushWorkerResult = { ...EMPTY, claimed: jobs.length, lockedOut: false };

            // Sequential on purpose — this paces requests so a broadcast backlog
            // doesn't burst against Expo and trip its rate limit.
            for (const job of jobs) {
                try {
                    const outcome = await this.service.processJob(job);
                    if (outcome === "sent") result.sent++;
                    else if (outcome === "delivered") result.delivered++;
                    else if (outcome === "retrying") result.retrying++;
                    else if (outcome === "exhausted") result.exhausted++;
                    else result.skipped++;
                } catch (error) {
                    // processJob handles its own failures; anything reaching here
                    // is a bug or a database problem. Leave the claim to the
                    // stale-claim sweep rather than losing the notification.
                    logger.error("Unexpected error while processing a push job", {
                        jobId: job.id,
                        dispatchId: job.dispatchId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            logger.info("Push job sweep finished", { ...result });
            return result;
        } finally {
            this.running = false;
            await this.releaseLock();
        }
    }

    private async acquireLock(): Promise<boolean> {
        if (!config.redis.enabled) return true;

        try {
            const ttl = Math.max(30, config.push.pollIntervalSeconds - 5);
            return await redis.setNX(LOCK_KEY, Date.now(), ttl);
        } catch (error) {
            logger.warn("Could not acquire push job lock — proceeding without it", {
                error: error instanceof Error ? error.message : String(error),
            });
            return true;
        }
    }

    private async releaseLock(): Promise<void> {
        if (!config.redis.enabled) return;

        try {
            await redis.del(LOCK_KEY);
        } catch (error) {
            logger.warn("Failed to release push job lock", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export const pushJobWorker = new PushJobWorker();
