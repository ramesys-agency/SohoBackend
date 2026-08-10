import { Router } from "express";
import { StatsController } from "./stats.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

const router = Router();
const controller = new StatsController();

// Revenue, order and customer totals plus recent orders with customer names —
// staff-only.
router.get("/dashboard", authMiddleware, adminMiddleware, controller.getDashboardStats);

export default router;
