import { Router } from "express";
import { WishlistController } from "./wishlist.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function registerWishlistRoutes(): Router {
    const router = Router();
    const controller = new WishlistController();

    router.get("/", authMiddleware, controller.toggleWishlist);

    return router;
}
