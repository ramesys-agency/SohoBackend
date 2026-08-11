import type { NextFunction, Request, Response } from "express";
import { AppPlacementService } from "./app-placement.service.js";
import { PageType, SectionType } from "@prisma/client";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

const toBool = (value: unknown): boolean | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    return value === true || value === "true";
};

export class AppPlacementController {
    private appPlacementService = new AppPlacementService();
    private storageService = new StorageService();

    /// Multipart form fields arrive as strings, so the file is uploaded here and
    /// the resulting URL handed to the service as a plain value.
    private async resolveImage(req: Request, folder: string, page?: string): Promise<string | undefined> {
        if (!req.file) {
            return (req.body as { image?: string }).image;
        }

        const fileExt = req.file.originalname.split(".").pop();
        const randomId = randomBytes(4).toString("hex");
        const key = `${folder}/${page || "placement"}_${randomId}.${fileExt}`;

        return this.storageService.uploadFile(req.file.buffer, key, req.file.mimetype);
    }

    getPlacements = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query = req.query as { page?: string; section?: string; isActive?: string };

            const result = await this.appPlacementService.getPlacements({
                page: query.page ? (query.page as PageType) : undefined,
                section: query.section ? (query.section as SectionType) : undefined,
                isActive: toBool(query.isActive),
            });

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

    createPlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = req.body as {
                name?: string;
                description?: string;
                page?: PageType;
                section?: SectionType;
                productId?: string;
                isBanner?: string | boolean;
                isActive?: string | boolean;
                displayOrder?: string;
                sourcePlacementId?: string;
            };

            if (!data.name?.trim()) {
                res.status(400).json({ success: false, message: "name is required" });
                return;
            }
            if (!data.page) {
                res.status(400).json({ success: false, message: "page is required" });
                return;
            }
            if (!data.section) {
                res.status(400).json({ success: false, message: "section is required" });
                return;
            }

            const imageUrl = await this.resolveImage(req, "placements", data.page);

            const result = await this.appPlacementService.createPlacement({
                name: data.name,
                description: data.description,
                page: data.page,
                section: data.section,
                productId: data.productId || undefined,
                isBanner: toBool(data.isBanner),
                isActive: toBool(data.isActive),
                image: imageUrl,
                displayOrder: data.displayOrder ? Number(data.displayOrder) : undefined,
                sourcePlacementId: data.sourcePlacementId || undefined,
            });

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    };

    duplicatePlacement = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const id = req.params["id"] as string;
            const data = req.body as {
                name?: string;
                page?: PageType;
                section?: SectionType;
                isActive?: string | boolean;
            };

            const result = await this.appPlacementService.duplicatePlacement(id, {
                name: data.name,
                page: data.page,
                section: data.section,
                isActive: toBool(data.isActive),
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
                name?: string;
                description?: string;
                page?: PageType;
                section?: SectionType;
                productId?: string;
                isBanner?: string | boolean;
                isActive?: string | boolean;
                displayOrder?: string;
            };

            const imageUrl = await this.resolveImage(req, `placements/update-${id}`, data.page);

            const result = await this.appPlacementService.updatePlacement(id, {
                name: data.name,
                description: data.description,
                page: data.page,
                section: data.section,
                // An explicit empty string clears the deep-link.
                productId: data.productId === undefined ? undefined : data.productId || null,
                isBanner: toBool(data.isBanner),
                isActive: toBool(data.isActive),
                image: imageUrl,
                displayOrder: data.displayOrder ? Number(data.displayOrder) : undefined,
            });

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    reorderPlacements = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const { placements } = req.body as { placements: { id: string; displayOrder: number }[] };
            const result = await this.appPlacementService.reorderPlacements(placements);
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
