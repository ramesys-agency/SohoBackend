import { PrismaService } from "../../core/services/index.js";
import { GenderType, Prisma, PageType, SectionType } from "../../generated/prisma/index.js";

export class CollectionService {
    private prisma = new PrismaService();

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
            where.collectionPlacements = {
                some: placementWhere,
            };
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const [collections, total] = await Promise.all([
            this.prisma.getClient().collection.findMany({
                where,
                orderBy: { createdAt: "desc" },
                include: {
                    collectionPlacements: {
                        ...(placementWhere ? { where: placementWhere } : {}),
                        orderBy: { displayOrder: "asc" },
                        include: {
                            collection: true,
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

    async addProductsToCollection(collectionId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const collection = await this.prisma.getClient().collection.findUnique({
            where: { id: collectionId },
        });

        if (!collection) {
            throw new Error("Collection not found");
        }

        const data = productIds.map((productId) => ({
            collectionId,
            productId,
        }));

        await this.prisma.getClient().productCollection.createMany({
            data,
            skipDuplicates: true,
        });

        return {
            success: true,
            message: "Products added to collection successfully",
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

    async deleteCollection(id: string) {
        const existing = await this.prisma.getClient().collection.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Collection not found");
        }

        // Remove all product associations first, then delete the collection
        await this.prisma.getClient().productCollection.deleteMany({ where: { collectionId: id } });
        await this.prisma.getClient().collection.delete({ where: { id } });

        return { success: true, message: "Collection deleted successfully" };
    }
}
