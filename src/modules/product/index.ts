import { Router } from "express";
import { ProductController } from "./product.controller.js";
import { optionalAuthMiddleware } from "../../core/middleware/index.js";

export type { CreateProductDto, UpdateProductDto } from "./product.types.js";
export type { IProductService } from "./product.interface.js";
export { ProductService } from "./product.service.js";
export { ProductController } from "./product.controller.js";

export function registerProductModule(): Router {
    const router = Router();

    const controller = new ProductController();

    router.get("/", optionalAuthMiddleware, controller.getAllProducts);
    router.get("/:productId", optionalAuthMiddleware, controller.getProductById);

    return router;
}
