import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import type { IHealthService } from "./health.interface.js";
import { HealthService } from "./health.service.js";

export class HealthController {
    private healthService: IHealthService = new HealthService();

    getHealth = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const health = await this.healthService.getHealthStatus();
            logger.info("Health check performed", { status: health.status });

            const statusCode = health.status === "error" ? 503 : 200;

            res.status(statusCode).json({
                success: health.status !== "error",
                data: health,
            });
        } catch (error) {
            next(error);
        }
    };

    getLiveness = (_req: Request, res: Response): void => {
        res.json({
            success: true,
            data: { status: "ok" },
        });
    };
}
