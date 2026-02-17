import { Router } from "express";
import { ProductController } from "./product.controller.js";

export type { CreateProductDto, UpdateProductDto } from "./product.types.js";
export type { IProductService } from "./product.interface.js";
export { ProductService } from "./product.service.js";
export { ProductController } from "./product.controller.js";

export function registerProductModule(): Router {
    const router = Router();

    const controller = new ProductController();

    router.get("/", controller.getAllProducts);

    return router;
}
