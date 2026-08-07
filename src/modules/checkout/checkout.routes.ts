import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";
import { CheckoutController } from "./checkout.controller.js";

export function registerCheckoutModule(): Router {
    const router = Router();
    const controller = new CheckoutController();

    router.post("/reserve", authMiddleware, controller.reserve);
    router.get("/:checkoutId", authMiddleware, controller.status);
    router.post("/:checkoutId/renew", authMiddleware, controller.renew);
    router.delete("/:checkoutId", authMiddleware, controller.release);

    return router;
}
