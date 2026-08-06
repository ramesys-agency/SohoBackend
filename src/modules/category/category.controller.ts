import type { NextFunction, Request, Response } from "express";
import { CategoryService, type GenderPlacementInput } from "./category.service.js";

export class CategoryController {
    private categoryService = new CategoryService();

    getAllCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as {
                isActive?: string;
                parentId?: string;
                gender?: string;
                page?: string;
                limit?: string;
            };
            const categories = await this.categoryService.getAllCategories(query);
            res.status(200).json(categories);
        } catch (error) {
            next(error);
        }
    };

    getParentCategories = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const query = req.query as {};
            const categories = await this.categoryService.getParentCategories();
            res.status(200).json(categories);
        } catch (error) {
            next(error);
        }
    };

    createCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = req.body as {
                name: string;
                parentId?: string;
                imageUrl?: string;
                genderImages?: GenderPlacementInput[];
                attributes?: Record<string, string> | any[];
            };
            const result = await this.categoryService.createCategory(data);
            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };

    updateCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const data = req.body as {
                name?: string;
                parentId?: string;
                imageUrl?: string;
                isActive?: boolean;
                displayOrder?: number;
                genderImages?: GenderPlacementInput[];
                attributes?: Record<string, string> | any[];
            };
            const result = await this.categoryService.updateCategory(id, data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    deleteCategory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const result = await this.categoryService.deleteCategory(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    getPageTitle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as {
                collectionId?: string;
                collectionSlug?: string;
                categoryId?: string;
            };
            const result = await this.categoryService.getPageTitle(query);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
    getCategoryHierarchy = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const query = req.query as {
                isActive?: string;
                page?: string;
                limit?: string;
            };
            const result = await this.categoryService.getCategoryHierarchy(query);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
    getCategoryById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const result = await this.categoryService.getCategoryById(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
