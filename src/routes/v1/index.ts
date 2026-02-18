import { Router } from "express";
import { registerProductModule } from "../../modules/product/index.js";
import { registerHealthModule } from "../../modules/health/index.js";
import { registerAuthModule } from "../../modules/auth/index.js";

export function createV1Router(): Router {
    const router = Router();

    // Register modules for v1
    router.use("/auth", registerAuthModule());
    router.use("/products", registerProductModule());
    router.use("/health", registerHealthModule());

    return router;
}
