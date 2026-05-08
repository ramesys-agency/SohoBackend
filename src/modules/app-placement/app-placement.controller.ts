import type { NextFunction, Request, Response } from "express";
import { AppPlacementService } from "./app-placement.service.js";
import { PageType, SectionType } from "@prisma/client";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

export class AppPlacementController {
    private appPlacementService = new AppPlacementService();
    private storageService = new StorageService();

    createPlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = req.body as {
                collectionId: string;
                page: PageType;
                section?: SectionType;
                isBanner?: string | boolean;
                isActive?: string | boolean;
                image?: string; // This might still be provided if they pass a URL instead of file
            };

            let imageUrl = data.image;

            if (req.file) {
                const fileExt = req.file.originalname.split(".").pop();
                const randomId = randomBytes(4).toString("hex");
                const folder = `placements/collection-${data.collectionId || "new"}`;
                const key = `${folder}/${data.page}_${randomId}.${fileExt}`;
                
                imageUrl = await this.storageService.uploadFile(
                    req.file.buffer,
                    key,
                    req.file.mimetype
                );
            }

            const isBanner = data.isBanner === "true" || data.isBanner === true;
            const isActive = data.isActive === undefined || data.isActive === "true" || data.isActive === true; // Default to true

            const result = await this.appPlacementService.createPlacement({
                collectionId: data.collectionId,
                page: data.page,
                section: data.section,
                isBanner: isBanner,
                isActive: isActive,
                image: imageUrl,
            });

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };

    updatePlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const data = req.body as {
                collectionId?: string;
                page?: PageType;
                section?: SectionType | null;
                isBanner?: string | boolean;
                isActive?: string | boolean;
                image?: string; // If sent as a string URL instead of a file
            };

            let imageUrl = data.image;

            if (req.file) {
                const fileExt = req.file.originalname.split(".").pop();
                const randomId = randomBytes(4).toString("hex");
                const folder = `placements/update-${id}`;
                const key = `${data.page || "placement"}_${randomId}.${fileExt}`;
                
                imageUrl = await this.storageService.uploadFile(
                    req.file.buffer,
                    `${folder}/${key}`,
                    req.file.mimetype
                );
            }

            const updatePayload: any = {
                collectionId: data.collectionId,
                page: data.page,
                section: (data.section as unknown as string) === "null" ? null : data.section,
                image: imageUrl,
            };

            if (data.isBanner !== undefined) {
                updatePayload.isBanner = data.isBanner === "true" || data.isBanner === true;
            }

            if (data.isActive !== undefined) {
                updatePayload.isActive = data.isActive === "true" || data.isActive === true;
            }

            const result = await this.appPlacementService.updatePlacement(id, updatePayload);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    deletePlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const result = await this.appPlacementService.deletePlacement(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
