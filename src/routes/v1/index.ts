import { Router } from "express";
import { registerProductModule } from "../../modules/product/index.js";
import { registerHealthModule } from "../../modules/health/index.js";
import { registerAuthModule } from "../../modules/auth/index.js";
import { registerWishlistModule } from "../../modules/wishlist/index.js";
import { registerCartModule } from "../../modules/cart/index.js";
import { registerReviewModule } from "../../modules/review/index.js";
import { registerUploadModule } from "../../modules/upload/index.js";
import { registerUserModule } from "../../modules/user/index.js";
import { registerOrdersModule } from "../../modules/orders/orders.routes.js";
// import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function createV1Router(): Router {
    const router = Router();

    // Register modules for v1
    router.use("/auth", registerAuthModule());
    router.use("/products", registerProductModule());
    router.use("/health", registerHealthModule());
    router.use("/wishlist", registerWishlistModule());
    router.use("/cart", registerCartModule());
    router.use("/reviews", registerReviewModule());
    router.use("/upload", registerUploadModule());
    router.use("/users", registerUserModule());
    router.use("/orders", registerOrdersModule());

    return router;
}
