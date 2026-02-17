import { Router } from "express";
import { logger } from "../config/logger.js";
import { createV1Router } from "./v1/index.js";
import { registerHealthModule } from "../modules/health/index.js";

export function createRouter(): Router {
    const router = Router();

    // Global Health Check (optional, can be kept for load balancers)
    router.use("/health", registerHealthModule());

    // API Version 1
    router.use("/api/v1", createV1Router());

    // Protected routes - apply authMiddleware to routes that need authentication
    // Example: router.use('/api', deps.authMiddleware, apiRoutes);

    logger.info("All routes registered");

    return router;
}
