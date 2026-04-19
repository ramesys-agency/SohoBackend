import { Router } from "express";
import { OrderController } from "./orders.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export function registerOrdersModule(): Router {
    const router = Router();
    const controller = new OrderController();

    // Authenticated routes
    router.get("/", authMiddleware, controller.getAllOrders);
    router.post("/", authMiddleware, controller.createOrder);
    router.get("/:orderId", authMiddleware, controller.getOrderById);

    // Admin routes
    router.get("/admin/all", authMiddleware, adminMiddleware, controller.adminGetAllOrders);
    router.patch("/admin/:orderId/status", authMiddleware, adminMiddleware, controller.updateOrderStatus);
    router.patch("/admin/:orderId/payment", authMiddleware, adminMiddleware, controller.adminUpdatePaymentStatus);
    router.post("/admin/:orderId/sync-roadrush", authMiddleware, adminMiddleware, controller.syncOrderWithRoadRush);
    router.post("/admin/:orderId/refresh-status", authMiddleware, adminMiddleware, controller.refreshOrderStatus);


    return router;
}



