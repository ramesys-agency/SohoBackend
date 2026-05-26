import type { NextFunction, Request, Response } from "express";
import { HomePromoService } from "./home-promo.service.js";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

export class HomePromoController {
    private service = new HomePromoService();
    private storageService = new StorageService();

    getSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await this.service.getHomePromo();
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

            const isActive = data.isActive === undefined || data.isActive === "true" || data.isActive === true;

            const result = await this.service.updateHomePromo({
                title: data.title,
                description: data.description,
                contentType: data.contentType,
                productId: data.productId || null,
                collectionId: data.collectionId || null,
                imageUrl: imageUrl || null,
                isActive: isActive,
            });

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
