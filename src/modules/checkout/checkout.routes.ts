import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";
import { CheckoutController } from "./checkout.controller.js";

export function registerCheckoutModule(): Router {
    const router = Router();
    const controller = new CheckoutController();

    // Pricing the app has to show before an order exists. Registered before
    // "/:checkoutId" so it isn't swallowed by it.
    router.get("/config", controller.getConfig);

    // The fee for a specific saved address. Authenticated because it reads one of
    // the caller's own addresses to decide the region.
    router.get("/delivery-fee", authMiddleware, controller.getAddressDeliveryFee);

    router.post("/reserve", authMiddleware, controller.reserve);
    router.get("/:checkoutId", authMiddleware, controller.status);
    router.post("/:checkoutId/renew", authMiddleware, controller.renew);
    router.delete("/:checkoutId", authMiddleware, controller.release);

    return router;
}
