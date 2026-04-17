import { Router } from "express";
import { CouponController } from "./coupon.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function createCouponRouter(): Router {
    const router = Router();
    const controller = new CouponController();

    // User Routes
    router.post("/validate", authMiddleware, controller.validateCoupon);

    // Admin Routes
    router.get("/", authMiddleware, controller.getAllCoupons);
    router.get("/:id", authMiddleware, controller.getCouponById);
    router.post("/", authMiddleware, controller.createCoupon);
    router.put("/:id", authMiddleware, controller.updateCoupon);
    router.put("/:id/expire", authMiddleware, controller.expireCoupon);
    router.delete("/:id", authMiddleware, controller.deleteCoupon);

    return router;
}
