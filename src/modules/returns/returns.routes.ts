import { Router } from "express";
import { ReturnController } from "./returns.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export function registerReturnsModule(): Router {
    const router = Router();
    const controller = new ReturnController();

    // Admin routes — declared before "/:..." style paths so "admin" is never
    // mistaken for an order id.
    router.get("/admin/all", authMiddleware, adminMiddleware, controller.adminGetAllReturns);
    router.post("/admin/order/:orderId", authMiddleware, adminMiddleware, controller.adminCreateReturns);
    router.patch("/admin/:returnId", authMiddleware, adminMiddleware, controller.adminUpdateReturnStatus);
    router.delete("/admin/:returnId", authMiddleware, adminMiddleware, controller.adminDeleteReturn);

    // Authenticated customer routes (read-only — returns are raised by an admin
    // after the customer contacts support).
    router.get("/", authMiddleware, controller.getMyReturns);
    router.get("/order/:orderId", authMiddleware, controller.getReturnsForOrder);

    return router;
}
