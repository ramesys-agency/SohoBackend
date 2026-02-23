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

        if (
            query.placementPage ||
            query.placementSection ||
            query.placementIsActive !== undefined ||
            query.isBanner !== undefined
        ) {
            where.collectionPlacements = {
                some: {
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
                },
            };
        }

        const collections = await this.prisma.getClient().collection.findMany({
            where,
            orderBy: { createdAt: "desc" },
            include: {
                collectionPlacements: {
                    orderBy: { displayOrder: "asc" },
                },
            },
        });

        return {
            success: true,
            data: collections,
        };
    }
}
