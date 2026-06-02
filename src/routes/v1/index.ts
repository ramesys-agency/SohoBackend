import { Router } from "express";
import { registerProductModule } from "../../modules/product/index.js";
import { registerHealthModule } from "../../modules/health/index.js";
import { registerAuthModule } from "../../modules/auth/index.js";
import { registerWishlistModule } from "../../modules/wishlist/index.js";
import { registerCartModule } from "../../modules/cart/index.js";
import { registerReviewModule } from "../../modules/review/index.js";
import { registerUploadModule } from "../../modules/upload/index.js";
import { registerUserModule } from "../../modules/user/index.js";
import { registerAddressModule } from "../../modules/address/index.js";
import { registerOrdersModule } from "../../modules/orders/orders.routes.js";
import { registerCategoryModule } from "../../modules/category/index.js";
import { registerCollectionModule } from "../../modules/collection/index.js";
import { registerAppPlacementModule } from "../../modules/app-placement/index.js";
import registerLogisticsModule from "../../modules/logistics/logistics.routes.js";
import { registerCouponModule } from "../../modules/coupon/index.js";
import { registerStatsModule } from "../../modules/stats/index.js";
import { registerHomePromoModule } from "../../modules/home-promo/index.js";
import { registerNotificationModule } from "../../modules/notification/index.js";

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
    router.use("/addresses", registerAddressModule());
    router.use("/categories", registerCategoryModule());
    router.use("/collections", registerCollectionModule());
    router.use("/app-placement", registerAppPlacementModule());
    router.use("/logistics", registerLogisticsModule);
    router.use("/coupons", registerCouponModule());
    router.use("/stats", registerStatsModule());
    router.use("/home-promo", registerHomePromoModule());
    router.use("/notifications", registerNotificationModule());

    return router;
}
