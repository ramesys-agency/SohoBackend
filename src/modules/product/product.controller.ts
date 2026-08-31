import type { NextFunction, Request, Response } from "express";
import { logger } from "../../config/logger.js";
import { ProductService } from "./product.service.js";
import type { IProductService } from "./product.interface.js";
import type { SearchProductsQueryDto } from "./product.types.js";
import {
    createProductSchema,
    searchProductsQuerySchema,
    updateProductSchema,
} from "./product.schema.js";

export class ProductController {
    private productService: IProductService = new ProductService();

    createProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            // Validate payload with Zod
            const validatedData = createProductSchema.parse(req.body);

            // Create product using the service
            const createdProduct = await this.productService.createProduct(validatedData);

            logger.info("Product created successfully", { productId: createdProduct.id });

            res.status(201).json({
                success: true,
                message: "Product created successfully",
                data: createdProduct,
            });
        } catch (error) {
            next(error);
        }
    };

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
            const parsed = searchProductsQuerySchema.safeParse(req.query);

            if (!parsed.success) {
                res.status(400).json({
                    success: false,
                    message: "Invalid search parameters",
                    error: parsed.error.issues,
                });
                return;
            }

            const searchQuery = parsed.data as SearchProductsQueryDto;

            // A query with neither a term nor a filter is answered rather than
            // rejected: it returns no products, but the facets the filter sheet
            // opens with.
            const result = await this.productService.searchProducts(
                searchQuery,
                req.user?.id
            );

            logger.info("Product search completed", {
                q: searchQuery.q,
                total: result.pagination.total,
            });
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    updateProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { productId } = req.params;

            if (!productId) {
                res.status(400).json({ success: false, message: "Product ID is required" });
                return;
            }

            const validatedData = updateProductSchema.parse(req.body);
            const updatedProduct = await this.productService.updateProduct(productId as string, validatedData as any);

            logger.info("Product updated successfully", { productId });

            res.status(200).json({
                success: true,
                message: "Product updated successfully",
                data: updatedProduct,
            });
        } catch (error) {
            next(error);
        }
    };

    deleteProduct = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { productId } = req.params;

            if (!productId) {
                res.status(400).json({ success: false, message: "Product ID is required" });
                return;
            }

            await this.productService.deleteProduct(productId as string);

            logger.info("Product deleted successfully", { productId });

            res.status(200).json({
                success: true,
                message: "Product deleted successfully",
            });
        } catch (error) {
            next(error);
        }
    };
}
