import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { OrderService } from "./orders.service.js";

/** Orders in these states will never change again, so they are never polled. */
const TERMINAL_STATUSES = ["delivered", "cancelled", "returned"] as const;

const LOCK_KEY = "logistics:roadrush:status-poll-lock";

export interface PollResult {
    scanned: number;
    updated: number;
    failed: number;
    /** True when another instance held the lock and this run was a no-op. */
    skipped: boolean;
}

/**
 * Polls RoadRush for status changes on in-flight orders.
 *
 * RoadRush has no webhook, so the only way to learn about a status change is to
 * ask. This runs in-process on an interval (same pattern as the license
 * heartbeat) and is also exposed as an admin endpoint so an external cron can
 * drive it instead — needed on hosts that suspend idle processes.
 *
 * A Redis lock keeps concurrent runs (multiple replicas, or a cron firing while
 * the interval is mid-sweep) from doubling up on RoadRush calls.
 */
export class OrderStatusPoller {
    private readonly orderService = new OrderService();
    private timer?: NodeJS.Timeout | undefined;
    private running = false;

    start(): void {
        if (!config.logistics.pollEnabled) {
            logger.info("Order status polling is disabled (ORDER_STATUS_POLL_ENABLED=false)");
            return;
        }

        const intervalMs = config.logistics.pollIntervalMinutes * 60 * 1000;
        logger.info(
            `Order status polling started (Interval: ${config.logistics.pollIntervalMinutes}m, Batch: ${config.logistics.pollBatchSize})`
        );

        this.timer = setInterval(() => {
            void this.runOnce().catch((error) => {
                logger.error("Order status poll failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            });
        }, intervalMs);
    }

    stop(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
            logger.info("Order status polling stopped");
        }
    }

    /**
     * Sweep one batch of in-flight orders. Safe to call directly (admin endpoint)
     * as well as from the interval.
     */
    async runOnce(): Promise<PollResult> {
        const empty: PollResult = { scanned: 0, updated: 0, failed: 0, skipped: true };

        // Guard against this process overlapping with itself when a sweep runs
        // longer than the interval.
        if (this.running) {
            logger.warn("Order status poll skipped — previous run is still in progress");
            return empty;
        }

        const lockAcquired = await this.acquireLock();
        if (!lockAcquired) {
            logger.info("Order status poll skipped — another instance holds the lock");
            return empty;
        }

        this.running = true;

        try {
            const orders = await prisma.getClient().order.findMany({
                where: {
                    orderCode: { not: null },
                    status: { notIn: [...TERMINAL_STATUSES] },
                },
                select: { id: true, orderCode: true },
                // Least-recently-synced first (never-synced first of all) so a
                // backlog larger than one batch still drains fairly.
                orderBy: { lastLogisticsSync: { sort: "asc", nulls: "first" } },
                take: config.logistics.pollBatchSize,
            });

            let updated = 0;
            let failed = 0;

            // Sequential on purpose — this paces the calls so a large backlog
            // doesn't burst against RoadRush.
            for (const order of orders) {
                try {
                    await this.orderService.refreshOrderStatus(order.id);
                    updated++;
                } catch (error) {
                    failed++;
                    logger.warn("Failed to refresh order status during poll", {
                        orderId: order.id,
                        orderCode: order.orderCode,
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }

            const result: PollResult = {
                scanned: orders.length,
                updated,
                failed,
                skipped: false,
            };

            if (orders.length) {
                logger.info("Order status poll finished", { ...result });
            }

            return result;
        } finally {
            this.running = false;
            await this.releaseLock();
        }
    }

    private async acquireLock(): Promise<boolean> {
        if (!config.redis.enabled) return true;

        try {
            // TTL is a safety net: if this process dies mid-sweep the lock still
            // expires rather than blocking every future run.
            const ttl = Math.max(60, config.logistics.pollIntervalMinutes * 60 - 5);
            return await redis.setNX(LOCK_KEY, Date.now(), ttl);
        } catch (error) {
            // Redis being down shouldn't stop polling on a single-instance setup.
            logger.warn("Could not acquire order status poll lock — proceeding without it", {
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
            logger.warn("Failed to release order status poll lock", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

export const orderStatusPoller = new OrderStatusPoller();
