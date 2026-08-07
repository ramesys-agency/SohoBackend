import "dotenv/config";
import { App } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";

// Core
import { ShutdownManager, verifyLicense, startLicenseHeartbeat } from "./core/utils/index.js";
import { orderStatusPoller } from "./modules/orders/orders.poller.js";
import { reservationSweeper } from "./modules/checkout/reservation.sweeper.js";
import { logisticsJobWorker } from "./modules/logistics/logistics-job.worker.js";
import { pushJobWorker } from "./modules/notification/push-job.worker.js";

// Routes

async function bootstrap(): Promise<void> {
    logger.info("Starting application...");

    // License Check
    await verifyLicense();

    // Start Heartbeat (Check every 15 minutes)
    startLicenseHeartbeat();

    // Connect to database with retry logic
    const maxRetries = 3;
    let retries = 0;
    while (retries < maxRetries) {
        try {
            await prisma.connect();
            logger.info("Database connected");
            break;
        } catch (error) {
            retries++;
            if (retries === maxRetries) {
                logger.error("Failed to connect to database after maximum retries", {
                    error: error instanceof Error ? error.message : String(error),
                    attempts: maxRetries,
                });
                throw error;
            }
            const delay = Math.min(1000 * Math.pow(2, retries), 10000); // Exponential backoff, max 10s
            logger.warn(
                `Database connection failed, retrying in ${delay}ms... (attempt ${retries}/${maxRetries})`,
                {
                    error: error instanceof Error ? error.message : String(error),
                }
            );
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    // Redis cache
    if (config.redis.enabled) {
        try {
            await redis.connect();
            logger.info("Redis connected");
        } catch (error) {
            logger.warn("Redis connection failed, continuing without cache", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    // Storage
    try {
        const { StorageService } = await import("./core/services/storage.service.js");
        const storageService = new StorageService();
        await storageService.ensureBucketExists();
        logger.info("Storage bucket verified/created");
    } catch (error) {
        logger.error("Failed to initialize storage:", {
            error: error instanceof Error ? error.message : String(error),
        });
        // We don't necessarily want to crash the whole app if storage is down, 
        // but it's a critical service. For now, just log the error.
    }

    // App
    const app = new App({
        port: config.port,
    });

    app.start();

    // Poll RoadRush for order status changes (they provide no webhook)
    orderStatusPoller.start();

    // Expire lapsed checkout stock holds
    reservationSweeper.start();

    // Retry handing orders to RoadRush when it was unreachable at checkout
    logisticsJobWorker.start();

    // Deliver queued push notifications and confirm them against Expo receipts
    pushJobWorker.start();

    // Graceful shutdown
    const shutdown = new ShutdownManager();
    shutdown.register(() => app.shutdown());
    shutdown.register(async () => orderStatusPoller.stop());
    shutdown.register(async () => reservationSweeper.stop());
    shutdown.register(async () => logisticsJobWorker.stop());
    shutdown.register(async () => pushJobWorker.stop());

    if (config.redis.enabled) {
        shutdown.register(() => redis.disconnect());
    }

    shutdown.register(() => prisma.disconnect());
    shutdown.listen();
}

bootstrap().catch((error) => {
    logger.error("Failed to start:", {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
