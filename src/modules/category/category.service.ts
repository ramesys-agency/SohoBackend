import { PrismaService } from "../../core/services/index.js";
import { GenderType, type Prisma } from "@prisma/client";
import { NotFoundError } from "../../core/errors/http-errors.js";
import { prisma } from "../../config/prisma.js";
import { getCategoryDescendants } from "../product/helpers/get-all-products.js";

/**
 * One gender tab's placement config for a category, as sent by the admin panel.
 * imageUrl is optional so a category can be featured in a tab using its base
 * image; isActive false keeps the row (preserving its image and order) while
 * hiding the category from that tab.
 */
export type GenderPlacementInput = {
    gender: string;
    imageUrl?: string | null;
    isActive?: boolean;
    displayOrder?: number;
};

/**
 * Counts only products a shopper could actually reach. Products default to
 * isPublished false on creation, and delete is a soft delete, so an unfiltered
 * count reports drafts and deleted stock as live inventory.
 */
const VISIBLE_PRODUCT_COUNT = {
    select: { products: { where: { isPublished: true, deletedAt: null } } },
} as const;

const toPlacementCreateData = (placement: GenderPlacementInput) => ({
    gender: placement.gender as GenderType,
    imageUrl: placement.imageUrl || null,
    isActive: placement.isActive ?? true,
    displayOrder: placement.displayOrder ?? 0,
});

export class CategoryService {
    private prisma = prisma;

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
            where.isActive = String(query.isActive) === "true";
        }

        if (query.parentId !== undefined) {
            if (query.parentId === "null" || query.parentId === null) {
                where.parentId = null;
            } else {
                where.parentId = query.parentId;
            }
        }

        let page = parseInt(query.page || "1", 10);
        let limit = parseInt(query.limit || "10", 10);
        if (isNaN(page) || page < 1) page = 1;
        if (isNaN(limit) || limit < 1) limit = 10;
        const skip = (page - 1) * limit;

        // Gender tabs are driven entirely by explicit placements configured in the
        // admin panel. A category appears under a gender only if it has an active
        // CategoryImage row for it — product inventory is deliberately not consulted,
        // so what merchandising configures is exactly what the app renders.
        if (gender && Object.values(GenderType).includes(gender as GenderType)) {
            return this.getCategoriesByGenderPlacement({
                gender: gender as GenderType,
                categoryWhere: where,
                page,
                limit,
                skip,
            });
        }

        const [categories, total] = await Promise.all([
            this.prisma.getClient().category.findMany({
                where,
                include: {
                    children: true,
                    genderImages: true, // Always include to allow robust fallbacks
                    // Lets a caller label a subcategory with its parent without a
                    // second lookup — and without depending on the parent happening
                    // to fall inside the same filtered page.
                    parent: { select: { id: true, name: true } },
                },
                orderBy: {
                    name: "asc",
                },
                skip,
                take: limit,
            }),
            this.prisma.getClient().category.count({ where }),
        ]);

        // Gender-less listing: no tab context, so there is no correct gender image
        // to prefer. Fall back to any configured one, then the base image.
        return {
            success: true,
            data: categories.map((cat: any) => ({
                ...cat,
                imageUrl: cat.genderImages?.[0]?.imageUrl || cat.imageUrl,
            })),
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    /**
     * Resolves the categories configured to appear in a single gender tab.
     *
     * Driven from CategoryImage rather than Category so that displayOrder sorting
     * and pagination both happen in the database — sorting after a `take` would
     * only order whichever page came back.
     */
    private async getCategoriesByGenderPlacement(args: {
        gender: GenderType;
        categoryWhere: Prisma.CategoryWhereInput;
        page: number;
        limit: number;
        skip: number;
    }) {
        const { gender, categoryWhere, page, limit, skip } = args;

        const where: Prisma.CategoryImageWhereInput = {
            gender,
            isActive: true,
            // deletedAt is explicit rather than inherited from the caller's isActive
            // filter: soft-delete happens to clear isActive today, but a placement
            // must never resurrect a deleted category if that ever changes.
            category: { ...categoryWhere, deletedAt: null },
        };

        const [placements, total] = await Promise.all([
            this.prisma.getClient().categoryImage.findMany({
                where,
                include: {
                    category: {
                        include: {
                            children: true,
                            genderImages: true,
                        },
                    },
                },
                orderBy: [{ displayOrder: "asc" }, { category: { name: "asc" } }],
                skip,
                take: limit,
            }),
            this.prisma.getClient().categoryImage.count({ where }),
        ]);

        return {
            success: true,
            data: placements.map((placement: any) => {
                const { category, ...rest } = placement;

                return {
                    ...category,
                    // The placement's own image, else the category's neutral base image.
                    // Never another gender's image — that is what previously surfaced
                    // womenswear photography under the Men tab.
                    imageUrl: rest.imageUrl || category.imageUrl,
                    placement: {
                        id: rest.id,
                        gender: rest.gender,
                        displayOrder: rest.displayOrder,
                    },
                };
            }),
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
                genderImages: true,
                _count: VISIBLE_PRODUCT_COUNT,
            },
            orderBy: {
                name: "asc",
            },
        });

        const data = categories.map((cat: any) => ({
            ...cat,
            imageUrl: cat.genderImages?.[0]?.imageUrl || cat.imageUrl,
            totalProducts: cat._count?.products || 0,
            children: (cat.children || []).map((child: any) => ({
                ...child,
                // Optional: add more mapping for children if needed
            })),
        }));

        return {
            success: true,
            data,
        };
    }

    async createCategory(data: {
        name: string;
        parentId?: string;
        imageUrl?: string;
        genderImages?: GenderPlacementInput[];
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
                attributesCreateData = data.attributes
                    .filter((attr: any) => attr && attr.key) // Ensure key exists
                    .map((attr: any) => ({
                        key: attr.key,
                        label: attr.label || attr.key,
                        type: attr.type || "text",
                        options: attr.options || null,
                        isFilterable: attr.isFilterable || false,
                    }));
            } else if (typeof data.attributes === "object") {
                attributesCreateData = Object.entries(data.attributes)
                    .filter(([key]) => key) // Ensure key is not empty
                    .map(([key, value]) => ({
                        key: key,
                        label: String(value || key),
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
                        create: data.genderImages.map(toPlacementCreateData),
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
            genderImages?: GenderPlacementInput[];
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

        // Upsert per gender rather than delete-and-recreate: these rows now carry
        // merchandising config (visibility, order), so wiping the ones absent from a
        // payload would silently discard an admin's tab setup. Genders the caller
        // omits entirely are left untouched.
        if (data.genderImages !== undefined) {
            for (const placement of data.genderImages) {
                const values = toPlacementCreateData(placement);
                await this.prisma.getClient().categoryImage.upsert({
                    where: {
                        categoryId_gender: { categoryId: id, gender: values.gender },
                    },
                    create: { ...values, categoryId: id },
                    update: values,
                });
            }
        }

        // Handle attributes: delete all existing and recreate
        if (data.attributes !== undefined) {
            await this.prisma
                .getClient()
                .categoryAttribute.deleteMany({ where: { categoryId: id } });

            let attributesCreateData: any[] = [];
            if (Array.isArray(data.attributes)) {
                attributesCreateData = data.attributes
                    .filter((attr: any) => attr && attr.key) // Ensure key exists
                    .map((attr: any) => ({
                        key: attr.key,
                        label: attr.label || attr.key,
                        type: attr.type || "text",
                        options: attr.options || null,
                        isFilterable: attr.isFilterable || false,
                        categoryId: id,
                    }));
            } else if (typeof data.attributes === "object") {
                attributesCreateData = Object.entries(data.attributes)
                    .filter(([key]) => key) // Ensure key is not empty
                    .map(([key, value]) => ({
                        key,
                        label: String(value || key),
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
            _count: VISIBLE_PRODUCT_COUNT,
            genderImages: true,
        } as const;

        const childrenArgs = {
            include: childrenInclude,
            orderBy: { name: "asc" as const },
            ...(Object.keys(childWhere).length ? { where: childWhere } : {}),
        };

        const [rootCategories, total] = await Promise.all([
            this.prisma.getClient().category.findMany({
                where,
                include: {
                    _count: VISIBLE_PRODUCT_COUNT,
                    genderImages: true,
                    children: childrenArgs,
                },
                orderBy: { name: "asc" },
                skip,
                take: limit,
            }),
            this.prisma.getClient().category.count({ where }),
        ]);

        const data = rootCategories.map((cat: any) => {
            const children = cat.children || [];
            const productsCount = (cat._count as { products: number })?.products ?? 0;

            return {
                ...cat,
                imageUrl: cat.genderImages?.[0]?.imageUrl || cat.imageUrl,
                totalProducts: productsCount,
                children: children.map((child: any) => {
                    const childProductsCount = (child._count as { products: number })?.products ?? 0;
                    return {
                        ...child,
                        imageUrl: child.genderImages?.[0]?.imageUrl || child.imageUrl,
                        totalProducts: childProductsCount,
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
            throw new NotFoundError("Category not found");
        }

        return {
            success: true,
            data: {
                ...category,
                genderProductCounts: await this.countProductsByGender(id),
            },
        };
    }

    /**
     * Published, non-deleted product count per gender for a category.
     *
     * Counts descendants too, mirroring getCategoryIds in the product module — the
     * admin panel links straight through to the product list filtered by this
     * category, and that filter expands to descendants. Counting only direct
     * children here would show a number that disagrees with the list it links to.
     */
    private async countProductsByGender(categoryId: string) {
        const db = this.prisma.getClient();
        const categoryIds = await getCategoryDescendants(db, categoryId);

        const genders = [GenderType.MEN, GenderType.WOMEN, GenderType.KIDS];
        const counts = await Promise.all(
            genders.map((gender) =>
                db.product.count({
                    where: {
                        categoryId: { in: categoryIds },
                        isPublished: true,
                        deletedAt: null,
                        gender: { has: gender },
                    },
                })
            )
        );

        return Object.fromEntries(
            genders.map((gender, index) => [gender, counts[index] ?? 0])
        ) as Record<GenderType, number>;
    }
}
