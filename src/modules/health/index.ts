import { Router } from "express";
import { HealthController } from "./health.controller.js";

export type { HealthStatus } from "./health.types.js";
export type { IHealthService } from "./health.interface.js";
export { HealthService } from "./health.service.js";
export { HealthController } from "./health.controller.js";

export function registerHealthModule(): Router {
    const router = Router();

    const controller = new HealthController();

    router.get("/", controller.getHealth);
    router.get("/live", controller.getLiveness);

    return router;
}
