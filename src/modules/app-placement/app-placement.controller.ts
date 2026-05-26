import type { NextFunction, Request, Response } from "express";
import { AppPlacementService } from "./app-placement.service.js";
import { CollectionService } from "../collection/collection.service.js";
import { PageType, SectionType } from "@prisma/client";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

export class AppPlacementController {
    private appPlacementService = new AppPlacementService();
    private collectionService = new CollectionService();
    private storageService = new StorageService();

    createPlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = req.body as {
                collectionId?: string;
                collectionName?: string;
                page: PageType;
                section?: SectionType;
                isBanner?: string | boolean;
                isActive?: string | boolean;
                image?: string;
            };

            // Resolve collectionId — create a new collection if only a name was supplied
            let collectionId = data.collectionId;
            if (!collectionId && data.collectionName) {
                const created = await this.collectionService.createCollection({
                    name: data.collectionName,
                });
                collectionId = created.data.id;
            }

            if (!collectionId) {
                res.status(400).json({ success: false, message: "collectionId or collectionName is required" });
                return;
            }

            let imageUrl = data.image;

            if (req.file) {
                const fileExt = req.file.originalname.split(".").pop();
                const randomId = randomBytes(4).toString("hex");
                const folder = `placements/collection-${collectionId}`;
                const key = `${folder}/${data.page}_${randomId}.${fileExt}`;

                imageUrl = await this.storageService.uploadFile(
                    req.file.buffer,
                    key,
                    req.file.mimetype
                );
            }

            const isBanner = data.isBanner === "true" || data.isBanner === true;
            const isActive = data.isActive === undefined || data.isActive === "true" || data.isActive === true;

            const result = await this.appPlacementService.createPlacement({
                collectionId,
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

    getPlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const result = await this.appPlacementService.getPlacementById(id);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    addPlacementProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const { productIds } = req.body as { productIds: string[] };
            const result = await this.appPlacementService.addProductsToPlacement(id, productIds);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    removePlacementProducts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const { productIds } = req.body as { productIds: string[] };
            const result = await this.appPlacementService.removeProductsFromPlacement(id, productIds);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
