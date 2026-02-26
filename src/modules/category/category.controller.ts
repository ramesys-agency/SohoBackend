import type { NextFunction, Request, Response } from "express";
import { CategoryService } from "./category.service.js";
import { GenderType } from "../../generated/prisma/index.js";

export class CategoryController {
    private categoryService = new CategoryService();

    getAllCategories = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as {
                isActive?: string;
                parentId?: string;
                gender?: GenderType;
                page?: string;
                limit?: string;
            };
            const categories = await this.categoryService.getAllCategories(query);
            res.status(200).json(categories);
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
}
