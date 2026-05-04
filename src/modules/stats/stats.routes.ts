import { Router } from "express";
import { StatsController } from "./stats.controller.js";

const router = Router();
const controller = new StatsController();

router.get("/dashboard", controller.getDashboardStats);

export default router;
