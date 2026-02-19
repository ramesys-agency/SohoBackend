import { Router } from "express";
import { OrderController } from "./orders.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function registerOrdersModule(): Router {
    const router = Router();
    const controller = new OrderController();

    // Authenticated routes
    router.get("/", authMiddleware, controller.getAllOrders);
    router.get("/:orderId", authMiddleware, controller.getOrderById);

    return router;
}
