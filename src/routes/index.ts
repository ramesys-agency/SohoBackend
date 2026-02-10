import { Router } from "express";
import { logger } from "../config/logger.js";
import { registerHealthModule } from "../modules/health/index.js";

export function createRouter(): Router {
    const router = Router();

    // Public routes
    router.use(registerHealthModule());

    // Protected routes - apply authMiddleware to routes that need authentication
    // Example: router.use('/api', deps.authMiddleware, apiRoutes);

    logger.info("All routes registered");

    return router;
}
