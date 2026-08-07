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
    router.post("/admin/poll-statuses", authMiddleware, adminMiddleware, controller.pollOrderStatuses);

    // Manual shipping — orders the automated hand-off gave up on.
    // `manual/count` is declared before `manual` so it is not swallowed by it.
    router.get("/admin/manual/count", authMiddleware, adminMiddleware, controller.adminGetManualCount);
    router.get("/admin/manual", authMiddleware, adminMiddleware, controller.adminGetManualOrders);
    router.post("/admin/:orderId/manual/handled", authMiddleware, adminMiddleware, controller.adminSetManualHandled);
    router.post("/admin/:orderId/manual/unhandled", authMiddleware, adminMiddleware, controller.adminSetManualHandled);
    router.post("/admin/:orderId/retry-sync", authMiddleware, adminMiddleware, controller.adminRetrySync);

    // Cron-friendly hooks for the background runners
    router.post("/admin/run-logistics-jobs", authMiddleware, adminMiddleware, controller.runLogisticsJobs);
    router.post("/admin/sweep-reservations", authMiddleware, adminMiddleware, controller.sweepReservations);


    return router;
}



