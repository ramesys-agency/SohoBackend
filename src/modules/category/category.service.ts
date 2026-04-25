import { PrismaService } from "../../core/services/index.js";
import type { Prisma } from "@prisma/client";

export class CategoryService {
    private prisma = new PrismaService();

    async getAllCategories(query: {
        isActive?: string;
        parentId?: string;
        gender?: string;
        page?: string;
        limit?: string;
    }) {
        const where: any = {};
        const gender = query.gender?.toUpperCase();


        if (query.isActive !== undefined) {
            where.isActive = query.isActive === "true" || query.isActive === true;
        }

        if (query.parentId !== undefined) {
            if (query.parentId === "null" || query.parentId === null) {
                where.parentId = null;
            } else {
                where.parentId = query.parentId;
            }
        }

        if (gender) {
            // Check if categories have products for this gender
            // OR have gender-specific images
            // OR have children that match these criteria
            where.OR = [
                {
                    products: {
                        some: {
                            gender: {
                                has: gender as any,
                            },
                        },
                    },
                },
                {
                    genderImages: {
                        some: {
                            gender: gender as any,
                        },
                    },
                },
                {
                    children: {
                        some: {
                            OR: [
                                {
                                    products: {
                                        some: {
                                            gender: {
                                                has: gender as any,
                                            },
                                        },
                                    },
                                },
                                {
                                    genderImages: {
                                        some: {
                                            gender: gender as any,
                                        },
                                    },
                                },
                            ],
                        },
                    },
                },
            ];
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const [categories, total] = await Promise.all([
            this.prisma.getClient().category.findMany({
                where,
                include: {
                    children: true,
                    genderImages: gender ? {
                        where: { gender: gender as any }
                    } : false
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
            data: categories.map((cat: any) => ({
                ...cat,
                imageUrl: cat.genderImages?.[0]?.imageUrl || cat.imageUrl
            })),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async getParentCategories() {
        const where: Prisma.CategoryWhereInput = {
            parentId: null,
        };

        const categories = await this.prisma.getClient().category.findMany({
            where,
            include: {
                children: true,
            },
            orderBy: {
                displayOrder: "asc",
            },
        });

        return {
            success: true,
            data: categories,
        };
    }

    async createCategory(data: {
        name: string;
        parentId?: string;
        imageUrl?: string;
        genderImages?: { gender: string; imageUrl: string }[];
        attributes?: Record<string, any> | any[];
    }) {
        const slug = data.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)+/g, "");

        let finalSlug = slug;
        let counter = 1;
        while (await this.prisma.getClient().category.findUnique({ where: { slug: finalSlug } })) {
            finalSlug = `${slug}-${counter}`;
            counter++;
        }

        // Map attributes from either array or key-value object
        let attributesCreateData: any[] = [];
        if (data.attributes) {
            if (Array.isArray(data.attributes)) {
                attributesCreateData = data.attributes.map((attr) => ({
                    key: attr.key,
                    label: attr.label || attr.key,
                    type: attr.type || "text",
                    options: attr.options || null,
                    isFilterable: attr.isFilterable || false,
                }));
            } else {
                attributesCreateData = Object.entries(data.attributes).map(([key, value]) => ({
                    key: key,
                    label: String(value), // Assuming value is the label
                    type: "text",
                    isFilterable: false,
                }));
            }
        }

        const category = await this.prisma.getClient().category.create({
            data: {
                name: data.name,
                slug: finalSlug,
                parentId: data.parentId || null,
                imageUrl: data.imageUrl || null,
                ...(data.genderImages && data.genderImages.length > 0 && {
                    genderImages: {
                        create: data.genderImages.map(gi => ({
                            gender: gi.gender as any,
                            imageUrl: gi.imageUrl
                        }))
                    }
                }),
                ...(attributesCreateData.length > 0 && {
                    attributes: {
                        create: attributesCreateData,
                    },
                }),
            },
            include: {
                attributes: true,
                genderImages: true,
            },
        });

        return {
            success: true,
            data: category,
            message: "Category created successfully",
        };
    }

    async updateCategory(
        id: string,
        data: {
            name?: string;
            parentId?: string;
            imageUrl?: string;
            isActive?: boolean;
            displayOrder?: number;
            genderImages?: { gender: string; imageUrl: string }[];
            attributes?: Record<string, any> | any[];
        }
    ) {
        const existing = await this.prisma.getClient().category.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Category not found");
        }

        // Build update payload
        const updateData: any = {};
        if (data.name !== undefined) {
            updateData.name = data.name;
            // Regenerate slug if name changes
            const slug = data.name
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/(^-|-$)+/g, "");
            let finalSlug = slug;
            let counter = 1;
            while (
                await this.prisma
                    .getClient()
                    .category.findFirst({ where: { slug: finalSlug, id: { not: id } } })
            ) {
                finalSlug = `${slug}-${counter++}`;
            }
            updateData.slug = finalSlug;
        }
        if (data.parentId !== undefined) updateData.parentId = data.parentId || null;
        if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl || null;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.displayOrder !== undefined) updateData.displayOrder = data.displayOrder;

        if (data.genderImages !== undefined) {
            await this.prisma.getClient().categoryImage.deleteMany({ where: { categoryId: id } });
            if (data.genderImages.length > 0) {
                updateData.genderImages = {
                    create: data.genderImages.map(gi => ({
                        gender: gi.gender as any,
                        imageUrl: gi.imageUrl
                    }))
                };
            }
        }

        // Handle attributes: delete all existing and recreate
        if (data.attributes !== undefined) {
            await this.prisma
                .getClient()
                .categoryAttribute.deleteMany({ where: { categoryId: id } });

            let attributesCreateData: any[] = [];
            if (Array.isArray(data.attributes)) {
                attributesCreateData = data.attributes.map((attr) => ({
                    key: attr.key,
                    label: attr.label || attr.key,
                    type: attr.type || "text",
                    options: attr.options || null,
                    isFilterable: attr.isFilterable || false,
                    categoryId: id,
                }));
            } else {
                attributesCreateData = Object.entries(data.attributes).map(([key, value]) => ({
                    key,
                    label: String(value),
                    type: "text",
                    isFilterable: false,
                    categoryId: id,
                }));
            }
            if (attributesCreateData.length > 0) {
                await this.prisma
                    .getClient()
                    .categoryAttribute.createMany({ data: attributesCreateData });
            }
        }

        const updated = await this.prisma.getClient().category.update({
            where: { id },
            data: updateData,
            include: { 
                attributes: true,
                genderImages: true,
            },
        });

        return { success: true, data: updated, message: "Category updated successfully" };
    }

    async deleteCategory(id: string) {
        const existing = await this.prisma.getClient().category.findUnique({ where: { id } });
        if (!existing) {
            throw new Error("Category not found");
        }

        // Soft delete
        await this.prisma.getClient().category.update({
            where: { id },
            data: { deletedAt: new Date(), isActive: false },
        });

        return { success: true, message: "Category deleted successfully" };
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

    async getCategoryHierarchy(query: {
        isActive?: string;
        page?: string;
        limit?: string;
    }) {
        const where: Prisma.CategoryWhereInput = {
            parentId: null,
        };

        if (query.isActive !== undefined) {
            where.isActive = query.isActive === "true";
        }

        const page = parseInt(query.page || "1", 10);
        const limit = parseInt(query.limit || "10", 10);
        const skip = (page - 1) * limit;

        const childWhere: Prisma.CategoryWhereInput = {};
        if (query.isActive !== undefined) {
            childWhere.isActive = query.isActive === "true";
        }

        const childrenInclude = {
            _count: { select: { products: true } },
            genderImages: true,
        } as const;

        const childrenArgs = {
            include: childrenInclude,
            orderBy: { displayOrder: "asc" as const },
            ...(Object.keys(childWhere).length ? { where: childWhere } : {}),
        };

        const [rootCategories, total] = await Promise.all([
            this.prisma.getClient().category.findMany({
                where,
                include: {
                    _count: {
                        select: { products: true },
                    },
                    genderImages: true,
                    children: childrenArgs,
                },
                orderBy: { displayOrder: "asc" },
                skip,
                take: limit,
            }),
            this.prisma.getClient().category.count({ where }),
        ]);

        const data = rootCategories.map((cat: any) => {
            const { _count, children, ...rest } = cat;
            return {
                ...rest,
                totalProducts: (_count as { products: number }).products,
                children: (children as any[]).map((child: any) => {
                    const { _count: childCount, ...childRest } = child;
                    return {
                        ...childRest,
                        totalProducts: (childCount as { products: number }).products,
                    };
                }),
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

    async getCategoryById(id: string) {
        const category = await this.prisma.getClient().category.findUnique({
            where: { id },
            include: {
                attributes: true,
                genderImages: true,
                parent: true,
                children: true,
            },
        });

        if (!category) {
            throw new Error("Category not found");
        }

        return {
            success: true,
            data: category,
        };
    }
}
