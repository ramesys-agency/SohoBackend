import { PrismaService } from "../../core/services/index.js";
import { GenderType } from "../../generated/prisma/index.js";

export class CategoryService {
    private prisma = new PrismaService();

    async getAllCategories(query: {
        isActive?: string;
        parentId?: string;
        gender?: GenderType;
        page?: string;
        limit?: string;
    }) {
        const where: any = {};

        if (query.gender) {
            where.gender = {
                has: query.gender,
            };
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive === "true";
        }

        if (query.parentId !== undefined) {
            if (query.parentId === "null") {
                where.parentId = null;
            } else {
                where.parentId = query.parentId;
            }
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const [categories, total] = await Promise.all([
            this.prisma.getClient().category.findMany({
                where,
                include: {
                    children: true,
                },
                orderBy: {
                    displayOrder: "asc",
                },
                skip,
                take: limit,
            }),
            this.prisma.getClient().category.count({ where }),
        ]);

        return {
            success: true,
            data: categories,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getPageTitle(query: {
        collectionId?: string;
        collectionSlug?: string;
        categoryId?: string;
    }) {
        const { collectionId, collectionSlug, categoryId } = query;

        if (collectionId) {
            const collection = await this.prisma.getClient().collection.findUnique({
                where: { id: collectionId },
                select: { id: true, name: true, slug: true },
            });
            if (!collection) {
                return { success: false, message: "Collection not found" };
            }
            return {
                success: true,
                type: "collection",
                id: collection.id,
                slug: collection.slug,
                name: collection.name,
            };
        }

        if (collectionSlug) {
            const collection = await this.prisma.getClient().collection.findUnique({
                where: { slug: collectionSlug },
                select: { id: true, name: true, slug: true },
            });
            if (!collection) {
                return { success: false, message: "Collection not found" };
            }
            return {
                success: true,
                type: "collection",
                id: collection.id,
                slug: collection.slug,
                name: collection.name,
            };
        }

        if (categoryId) {
            const category = await this.prisma.getClient().category.findUnique({
                where: { id: categoryId },
                select: { id: true, name: true, slug: true },
            });
            if (!category) {
                return { success: false, message: "Category not found" };
            }
            return {
                success: true,
                type: "category",
                id: category.id,
                slug: category.slug,
                name: category.name,
            };
        }

        return {
            success: false,
            message: "Provide one of: collectionId, collectionSlug, or categoryId",
        };
    }
}
