import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { ProductService } from "./product.service.js";
import type { IProductService } from "./product.interface.js";
import type { SearchProductsQueryDto } from "./product.types.js";

export class ProductController {
    private productService: IProductService = new ProductService();

    getAllProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as unknown as any; // Cast to any to assume shape, or validate properly
            // In a real app, use class-validator or zod to validate query params
            const userId = req.user?.id;

            const products = await this.productService.getAllProducts(query, userId);
            logger.info("Products fetched successfully", { count: products.products.length });

            res.status(200).json(products);
        } catch (error) {
            next(error);
        }
    };

    getProductById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { productId } = req.params;
            const userId = req.user?.id;

            if (!productId) {
                throw new Error("Product ID is required");
            }

            const product = await this.productService.getProductById(productId as string, userId);
            logger.info("Product fetched successfully", { productId });

            res.status(200).json(product);
        } catch (error) {
            next(error);
        }
    };

    searchProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { q, limit } = req.query as { q?: string; limit?: string };
            const userId = req.user?.id;

            if (!q || q.trim().length === 0) {
                res.status(400).json({
                    success: false,
                    message: "Query parameter 'q' is required",
                });
                return;
            }

            const searchQuery: SearchProductsQueryDto = { q: q.trim() };
            if (limit !== undefined) searchQuery.limit = Number(limit);

            const result = await this.productService.searchProducts(searchQuery, userId);

            logger.info("Product search completed", { q, count: result.count });
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
