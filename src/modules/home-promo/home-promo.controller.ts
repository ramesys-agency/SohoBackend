import type { NextFunction, Request, Response } from "express";
import { HomePromoService } from "./home-promo.service.js";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

export class HomePromoController {
    private service = new HomePromoService();
    private storageService = new StorageService();

    getAll = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const isActiveQuery = req.query.isActive;
            const queryParams: any = {};
            if (isActiveQuery !== undefined) {
                queryParams.isActive = isActiveQuery === "true";
            }
            const result = await this.service.getHomePromos(queryParams);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    getById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const result = await this.service.getHomePromoById(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    create = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = req.body as {
                title: string;
                description: string;
                contentType: string;
                productId?: string;
                collectionId?: string;
                isActive?: string | boolean;
                image?: string;
            };

            let imageUrl = data.image || null;

            if (req.file) {
                const fileExt = req.file.originalname.split(".").pop();
                const randomId = randomBytes(4).toString("hex");
                const folder = `home-promo`;
                const key = `${folder}/banner_${randomId}.${fileExt}`;

                imageUrl = await this.storageService.uploadFile(
                    req.file.buffer,
                    key,
                    req.file.mimetype
                );
            }

            const isActive = data.isActive === undefined || data.isActive === "true" || data.isActive === true;

            const result = await this.service.createHomePromo({
                title: data.title,
                description: data.description,
                contentType: data.contentType,
                productId: data.productId || null,
                collectionId: data.collectionId || null,
                imageUrl: imageUrl,
                isActive: isActive,
            });

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };

    update = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const data = req.body as {
                title?: string;
                description?: string;
                contentType?: string;
                productId?: string;
                collectionId?: string;
                isActive?: string | boolean;
                image?: string;
            };

            let imageUrl = data.image;

            if (req.file) {
                const fileExt = req.file.originalname.split(".").pop();
                const randomId = randomBytes(4).toString("hex");
                const folder = `home-promo`;
                const key = `${folder}/banner_${randomId}.${fileExt}`;

                imageUrl = await this.storageService.uploadFile(
                    req.file.buffer,
                    key,
                    req.file.mimetype
                );
            }

            const isActive = data.isActive === undefined ? undefined : (data.isActive === "true" || data.isActive === true);

            const updatePayload: {
                title?: string;
                description?: string;
                contentType?: string;
                productId?: string | null;
                collectionId?: string | null;
                imageUrl?: string | null;
                isActive?: boolean;
            } = {};

            if (data.title !== undefined) updatePayload.title = data.title;
            if (data.description !== undefined) updatePayload.description = data.description;
            if (data.contentType !== undefined) updatePayload.contentType = data.contentType;
            if (data.productId !== undefined) updatePayload.productId = data.productId || null;
            if (data.collectionId !== undefined) updatePayload.collectionId = data.collectionId || null;
            if (imageUrl !== undefined) updatePayload.imageUrl = imageUrl || null;
            if (isActive !== undefined) updatePayload.isActive = isActive;

            const result = await this.service.updateHomePromo(id, updatePayload);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    delete = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params.id as string;
            const result = await this.service.deleteHomePromo(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
