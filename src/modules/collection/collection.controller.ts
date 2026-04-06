import type { NextFunction, Request, Response } from "express";
import { CollectionService } from "./collection.service.js";
import type { GenderType } from "../../generated/prisma/index.js";

export class CollectionController {
    private collectionService = new CollectionService();

    getAllCollections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as {
                isActive?: string;
                isBanner?: string;
                gender?: GenderType;
                slug?: string;
                search?: string;
                placementPage?: string;
                placementSection?: string;
                placementIsActive?: string;
                page?: string;
                limit?: string;
            };
            const collections = await this.collectionService.getAllCollections(query);
            res.status(200).json(collections);
        } catch (error) {
            next(error);
        }
    };

    addProductsToCollection = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const id = req.params.id as string;
            const productIds = req.body.productIds as string[];

            const result = await this.collectionService.addProductsToCollection(id, productIds);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    removeProductsFromCollection = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const id = req.params.id as string;
            const productIds = req.body.productIds as string[];

            const result = await this.collectionService.removeProductsFromCollection(id, productIds);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    updateCollection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const data = req.body as {
                name?: string;
                gender?: GenderType[];
                isActive?: boolean;
            };
            const result = await this.collectionService.updateCollection(id, data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    deleteCollection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const result = await this.collectionService.deleteCollection(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
