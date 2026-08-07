import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { logisticsJobService } from "./logistics-job.service.js";

const LOCK_KEY = "logistics:job-worker-lock";

export interface WorkerResult {
    claimed: number;
    succeeded: number;
    failed: number;
    exhausted: number;
    /** True when another run held the lock and this one was a no-op. */
    skipped: boolean;
}

/**
 * Drains the logistics retry queue.
 *
 * Same shape as OrderStatusPoller: an in-process interval, a Redis lock so
 * replicas don't double up, and an admin endpoint so an external cron can drive
 * it on hosts that suspend idle processes. Jobs are also claimed at the database
 * level, so correctness does not depend on Redis being available.
 */
export class LogisticsJobWorker {
    private timer?: NodeJS.Timeout | undefined;
    private running = false;

    start(): void {
        if (!config.logistics.job.enabled) {
            logger.info("Logistics job worker is disabled (LOGISTICS_JOB_ENABLED=false)");
            return;
        }

        const intervalMs = config.logistics.job.pollIntervalSeconds * 1000;
        logger.info(
            `Logistics job worker started (Interval: ${config.logistics.job.pollIntervalSeconds}s, Retries: ${config.logistics.job.retryDelaysMinutes.join("m, ")}m)`
        );

        this.timer = setInterval(() => {
            void this.runOnce().catch((error) => {
                logger.error("Logistics job sweep failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
            logger.info("Logistics job worker stopped");
        }
    }

    /**
     * Process one batch of due jobs. Safe to call directly — the order endpoint
     * kicks it right after a purchase so the happy path syncs immediately
     * instead of waiting for the next tick.
     */
    async runOnce(): Promise<WorkerResult> {
        const empty: WorkerResult = {
            claimed: 0,
            succeeded: 0,
            failed: 0,
            exhausted: 0,
            skipped: true,
        };

        if (this.running) return empty;
        if (!(await this.acquireLock())) return empty;

        this.running = true;

        try {
            await logisticsJobService.requeueStaleClaims();

            const jobs = await logisticsJobService.claimDueJobs(config.logistics.job.batchSize);
            if (!jobs.length) {
                return { ...empty, skipped: false };
            }

            let succeeded = 0;
            let failed = 0;
            let exhausted = 0;

            // Sequential on purpose — this paces calls so a backlog doesn't
            // burst against RoadRush.
            for (const job of jobs) {
                try {
                    const outcome = await logisticsJobService.processJob(job);
                    if (outcome === "succeeded") succeeded++;
                    else if (outcome === "failed") failed++;
                    else if (outcome === "exhausted") exhausted++;
                } catch (error) {
                    // processJob handles its own failures; anything reaching here
                    // is a bug or a database problem. Leave the claim to the
                    // stale-claim sweep rather than losing the job.
                    failed++;
                    logger.error("Unexpected error while processing a logistics job", {
                        jobId: job.id,
                        orderId: job.orderId,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            const result: WorkerResult = {
                claimed: jobs.length,
                succeeded,
                failed,
                exhausted,
                skipped: false,
            };
            logger.info("Logistics job sweep finished", { ...result });
            return result;
        } finally {
            this.running = false;
            await this.releaseLock();
        }
    }

    private async acquireLock(): Promise<boolean> {
        if (!config.redis.enabled) return true;

        try {
            const ttl = Math.max(30, config.logistics.job.pollIntervalSeconds - 5);
            return await redis.setNX(LOCK_KEY, Date.now(), ttl);
        } catch (error) {
            logger.warn("Could not acquire logistics job lock — proceeding without it", {
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
            logger.warn("Failed to release logistics job lock", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export const logisticsJobWorker = new LogisticsJobWorker();
