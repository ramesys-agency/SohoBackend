import type { HealthStatus } from "./health.types.js";
import type { IHealthService } from "./health.interface.js";
import { prisma } from "../../config/prisma.js";
import { redis } from "../../config/redis.js";
import { config } from "../../config/index.js";

export class HealthService implements IHealthService {
    constructor() {}

    async getHealthStatus(): Promise<HealthStatus> {
        const status: HealthStatus = {
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        };

        // Check database connection
        const isDbConnected = await prisma.checkConnection();
        status.database = { connected: isDbConnected };

        // Check Redis connection only if enabled
        if (config.redis.enabled) {
            const isRedisConnected = redis.isConnected();
            status.cache = { connected: isRedisConnected };
        }

        // Set overall status to error if database is down
        if (!isDbConnected) {
            status.status = "error";
        }

        return status;
    }
}
