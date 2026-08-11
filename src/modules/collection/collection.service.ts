import { GenderType, Prisma, PageType, SectionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/// Collections are created and destroyed by the placement module — there is no
/// standalone "create collection" path. What lives here is reading them and
/// editing the product list, which stays mirrored with the owning placement.

export class CollectionService {
    private prisma = prisma;

    async getAllCollections(query: {
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
    }) {
        const where: Prisma.CollectionWhereInput = {};

        if (query.isActive !== undefined) {
            where.isActive = query.isActive === "true";
        }

        if (query.slug) {
            where.slug = query.slug;
        }

        if (query.search) {
            where.name = {
                contains: query.search,
                mode: "insensitive",
            };
        }

        if (query.gender) {
            where.gender = {
                has: query.gender,
            };
        }

        const placementWhere: Prisma.CollectionPlacementWhereInput | undefined =
            query.placementPage ||
            query.placementSection ||
            query.placementIsActive !== undefined ||
            query.isBanner !== undefined
                ? {
                      ...(query.placementPage && { page: query.placementPage as PageType }),
                      ...(query.placementSection && {
                          section: query.placementSection as SectionType,
                      }),
                      ...(query.isBanner !== undefined && {
                          isBanner: query.isBanner === "true",
                      }),
                      ...(query.placementIsActive !== undefined && {
                          isActive: query.placementIsActive === "true",
                      }),
                  }
                : undefined;

        if (placementWhere) {
            where.placement = { is: placementWhere };
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const [collections, total] = await Promise.all([
            this.prisma.getClient().collection.findMany({
                where,
                orderBy: { createdAt: "desc" },
                include: {
                    placement: {
                        include: {
                            _count: { select: { products: true } },
                        },
                    },
                    _count: {
                        select: { products: true },
                    },
                },
                skip,
                take: limit,
            }),
            this.prisma.getClient().collection.count({ where }),
        ]);

        const data = collections.map((col: any) => {
            const { _count, ...rest } = col;
            return {
                ...rest,
                productCount: _count?.products || 0,
            };
        });

        return {
            success: true,
            data,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /// Products stay mirrored: the collection is what coupons and slug lookups
    /// see, the placement is what the storefront renders.
    async addProductsToCollection(collectionId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const collection = await this.prisma.getClient().collection.findUnique({
            where: { id: collectionId },
            include: { placement: { select: { id: true } } },
        });

        if (!collection) {
            throw new Error("Collection not found");
        }

        const client = this.prisma.getClient();
        const placementId = collection.placement?.id;

        await client.$transaction([
            client.productCollection.createMany({
                data: productIds.map((productId) => ({ collectionId, productId })),
                skipDuplicates: true,
            }),
            ...(placementId
                ? [
                      client.collectionPlacementProduct.createMany({
                          data: productIds.map((productId) => ({ placementId, productId })),
                          skipDuplicates: true,
                      }),
                  ]
                : []),
        ]);

        return {
            success: true,
            message: "Products added to collection successfully",
        };
    }

    async removeProductsFromCollection(collectionId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const collection = await this.prisma.getClient().collection.findUnique({
            where: { id: collectionId },
            include: { placement: { select: { id: true } } },
        });

        if (!collection) {
            throw new Error("Collection not found");
        }

        const client = this.prisma.getClient();
        const placementId = collection.placement?.id;

        await client.$transaction([
            client.productCollection.deleteMany({
                where: { collectionId, productId: { in: productIds } },
            }),
            ...(placementId
                ? [
                      client.collectionPlacementProduct.deleteMany({
                          where: { placementId, productId: { in: productIds } },
                      }),
                  ]
                : []),
        ]);

        return {
            success: true,
            message: "Products removed from collection successfully",
        };
    }

    async updateCollection(
        id: string,
        data: {
            name?: string;
            gender?: GenderType[];
            isActive?: boolean;
        }
    ) {
        const existing = await this.prisma.getClient().collection.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Collection not found");
        }

        const updateData: any = {};

        if (data.name !== undefined) {
            updateData.name = data.name;
            // Regenerate slug from new name
            const slug = data.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)+/g, "");
            let finalSlug = slug;
            let counter = 1;
            while (
                await this.prisma
                    .getClient()
                    .collection.findFirst({ where: { slug: finalSlug, id: { not: id } } })
            ) {
                finalSlug = `${slug}-${counter++}`;
            }
            updateData.slug = finalSlug;
        }

        if (data.gender !== undefined) updateData.gender = data.gender;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;

        const updated = await this.prisma.getClient().collection.update({
            where: { id },
            data: updateData,
        });

        return { success: true, data: updated, message: "Collection updated successfully" };
    }

    /// Deleting a collection takes its placement with it — cascades handle the
    /// product links, the placement and its curated list.
    async deleteCollection(id: string) {
        const existing = await this.prisma.getClient().collection.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Collection not found");
        }

        await this.prisma.getClient().collection.delete({ where: { id } });

        return { success: true, message: "Collection deleted successfully" };
    }
}
