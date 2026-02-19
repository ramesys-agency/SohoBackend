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

    getProductById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { productId } = req.params;
            if (!productId) {
                throw new Error("Product ID is required");
            }

            const product = await this.productService.getProductById(productId as string);
            logger.info("Product fetched successfully", { productId });

            res.status(200).json(product);
        } catch (error) {
            next(error);
        }
    };
}
