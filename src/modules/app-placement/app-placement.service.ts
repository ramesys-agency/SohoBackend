import { PrismaService } from "../../core/services/index.js";
import { PageType, SectionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";


export class AppPlacementService {
    private prisma = prisma;

    async createPlacement(data: {
        collectionId: string;
        page: PageType;
        section?: SectionType | undefined;
        isBanner: boolean;
        isActive: boolean;
        image?: string | undefined;
    }) {
        const placement = await this.prisma.getClient().collectionPlacement.create({
            data: {
                collectionId: data.collectionId,
                page: data.page,
                section: data.section || null,
                isBanner: data.isBanner ?? false,
                isActive: data.isActive ?? true,
                imageUrl: data.image || null,
            },
        });

        return {
            success: true,
            data: placement,
            message: "Placement created successfully",
        };
    }

    async updatePlacement(
        id: string,
        data: {
            collectionId?: string;
            page?: PageType;
            section?: SectionType | undefined;
            isBanner?: boolean;
            isActive?: boolean;
            image?: string | undefined;
        }
    ) {
        const existing = await this.prisma.getClient().collectionPlacement.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Placement not found");
        }

        const updateData: any = {};
        if (data.collectionId !== undefined) updateData.collectionId = data.collectionId;
        if (data.page !== undefined) updateData.page = data.page;
        if (data.section !== undefined) updateData.section = data.section || null;
        if (data.isBanner !== undefined) updateData.isBanner = data.isBanner;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.image !== undefined) updateData.imageUrl = data.image;

        const updated = await this.prisma.getClient().collectionPlacement.update({
            where: { id },
            data: updateData,
        });

        return { success: true, data: updated, message: "Placement updated successfully" };
    }

    async deletePlacement(id: string) {
        const existing = await this.prisma.getClient().collectionPlacement.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Placement not found");
        }

        await this.prisma.getClient().collectionPlacement.delete({
            where: { id },
        });

        return { success: true, message: "Placement deleted successfully" };
    }

    async getPlacementById(id: string) {
        const placement = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id },
            include: {
                collection: true,
                products: {
                    include: { product: true },
                    orderBy: { displayOrder: "asc" },
                },
                _count: { select: { products: true } },
            },
        });

        if (!placement) {
            throw new Error("Placement not found");
        }

        return { success: true, data: placement };
    }

    async addProductsToPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const placement = await this.prisma.getClient().collectionPlacement.findUnique({ where: { id: placementId } });
        if (!placement) {
            throw new Error("Placement not found");
        }

        await this.prisma.getClient().collectionPlacementProduct.createMany({
            data: productIds.map((productId) => ({ placementId, productId })),
            skipDuplicates: true,
        });

        return { success: true, message: "Products added to placement successfully" };
    }

    async removeProductsFromPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        await this.prisma.getClient().collectionPlacementProduct.deleteMany({
            where: {
                placementId,
                productId: { in: productIds },
            },
        });

        return { success: true, message: "Products removed from placement successfully" };
    }
}
