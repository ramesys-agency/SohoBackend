import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { ProductService } from "./product.service.js";
import type { IProductService } from "./product.interface.js";

export class ProductController {
    private productService: IProductService = new ProductService();

    getAllProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as unknown as any; // Cast to any to assume shape, or validate properly
            // In a real app, use class-validator or zod to validate query params

            const products = await this.productService.getAllProducts(query);
            logger.info("Products fetched successfully", { count: products.products.length });

            res.status(200).json(products);
        } catch (error) {
            next(error);
        }
    };
}
