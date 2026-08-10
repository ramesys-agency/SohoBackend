import { Router } from "express";
import { ProductController } from "./product.controller.js";
import {
    adminMiddleware,
    authMiddleware,
    optionalAuthMiddleware,
} from "../../core/middleware/index.js";

export type { CreateProductDto, UpdateProductDto } from "./product.types.js";
export type { IProductService } from "./product.interface.js";
export { ProductService } from "./product.service.js";
export { ProductController } from "./product.controller.js";

export function registerProductModule(): Router {
    const router = Router();

    const controller = new ProductController();

    // Catalogue reads stay open to the storefront; writes are staff-only.
    router.get("/", optionalAuthMiddleware, controller.getAllProducts);
    router.get("/search", optionalAuthMiddleware, controller.searchProducts);
    router.get("/:productId", optionalAuthMiddleware, controller.getProductById);

    router.post("/", authMiddleware, adminMiddleware, controller.createProduct);
    router.put("/:productId", authMiddleware, adminMiddleware, controller.updateProduct);
    router.delete("/:productId", authMiddleware, adminMiddleware, controller.deleteProduct);

    return router;
}
