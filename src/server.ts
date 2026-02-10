import "dotenv/config";
import { App } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { prisma } from "./config/prisma.js";
import { redis } from "./config/redis.js";

// Core
import { ShutdownManager } from "./core/utils/index.js";

// Routes

async function bootstrap(): Promise<void> {
    logger.info("Starting application...");

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

    // App
    const app = new App({
        port: config.port,
    });

    app.start();

    // Graceful shutdown
    const shutdown = new ShutdownManager();
    shutdown.register(() => app.shutdown());

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
