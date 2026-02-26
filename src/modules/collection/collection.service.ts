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
                },
                skip,
                take: limit,
            }),
            this.prisma.getClient().collection.count({ where }),
        ]);

        return {
            success: true,
            data: collections,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }
}
