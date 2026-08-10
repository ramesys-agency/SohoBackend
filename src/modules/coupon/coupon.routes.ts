import { Router } from "express";
import { CouponController } from "./coupon.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export function createCouponRouter(): Router {
    const router = Router();
    const controller = new CouponController();

    // User Routes — a shopper may test a code against their own cart, and
    // nothing else. Listing coupons would hand out every unadvertised code.
    router.post("/validate", authMiddleware, controller.validateCoupon);

    // Admin Routes
    router.get("/", authMiddleware, adminMiddleware, controller.getAllCoupons);
    router.get("/:id", authMiddleware, adminMiddleware, controller.getCouponById);
    router.post("/", authMiddleware, adminMiddleware, controller.createCoupon);
    router.put("/:id", authMiddleware, adminMiddleware, controller.updateCoupon);
    router.put("/:id/expire", authMiddleware, adminMiddleware, controller.expireCoupon);
    router.delete("/:id", authMiddleware, adminMiddleware, controller.deleteCoupon);

    return router;
}
