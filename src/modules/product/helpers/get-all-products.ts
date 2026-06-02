// --- Helpers ---

import type { PrismaClient } from "@prisma/client";

export const getCategoryIds = async (
    prisma: PrismaClient,
    categorySlug?: string,
    categoryId?: string
): Promise<string[] | undefined> => {
    if (!categorySlug && !categoryId) return undefined;

    let targetCategoryId = categoryId;

    if (!targetCategoryId && categorySlug) {
        const category = await prisma.category.findUnique({
            where: { slug: categorySlug },
        });

        if (!category) {
            return ["invalid-category"]; // Return check to ensure 0 results
        }
        targetCategoryId = category.id;
    }

    if (!targetCategoryId) {
        return ["invalid-category"];
    }

    return getCategoryDescendants(prisma, targetCategoryId);
};

export const getPlacementProductIds = async (
    prisma: PrismaClient,
    placementId: string
): Promise<string[]> => {
    const rows = await prisma.collectionPlacementProduct.findMany({
        where: { placementId },
        orderBy: { displayOrder: "asc" },
        select: { productId: true },
    });
    return rows.map((r) => r.productId);
};

export const getCollectionProductIds = async (
    prisma: PrismaClient,
    collectionSlug?: string,
    collectionId?: string
): Promise<string[] | undefined> => {
    if (!collectionSlug && !collectionId) return undefined;

    let targetCollectionId = collectionId;

    if (!targetCollectionId && collectionSlug) {
        const collection = await prisma.collection.findUnique({
            where: { slug: collectionSlug },
            select: { id: true },
        });

        if (!collection) {
            return ["invalid-collection"];
        }
        targetCollectionId = collection.id;
    }

    if (!targetCollectionId) {
        return ["invalid-collection"];
    }

    const productCollections = await prisma.productCollection.findMany({
        where: { collectionId: targetCollectionId },
        orderBy: { displayOrder: "asc" },
        select: { productId: true },
    });

    return productCollections.map((pc) => pc.productId);
};

export const getAvailableFilters = async (
    prisma: PrismaClient,
    categorySlug?: string,
    categoryId?: string,
    hasProducts: boolean = false
): Promise<any[]> => {
    if ((!categorySlug && !categoryId) || !hasProducts) return [];

    let whereClause: any = {};
    if (categoryId) {
        whereClause = { id: categoryId };
    } else if (categorySlug) {
        whereClause = { slug: categorySlug };
    }

    const category = await prisma.category.findUnique({
        where: whereClause,
        include: { attributes: true },
    });

    return (
        (category as any)?.attributes?.map((attr: any) => ({
            key: attr.key,
            label: attr.label,
            options: Array.isArray(attr.options) ? attr.options : [],
        })) || []
    );
};

const getCategoryDescendants = async (
    prisma: PrismaClient,
    categoryId: string
): Promise<string[]> => {
    // Fetch all categories
    // This is not efficient for huge category trees but fine for normal e-commerce depth
    const allCategories = await prisma.category.findMany({
        select: { id: true, parentId: true },
    });

    const descendants: string[] = [categoryId];
    const queue = [categoryId];

    while (queue.length > 0) {
        const currentId = queue.shift();
        const children = allCategories.filter((c) => c.parentId === currentId);
        for (const child of children) {
            descendants.push(child.id);
            queue.push(child.id);
        }
    }
    return descendants;
};

// --- Builders ---

export const buildFilterConditions = (params: {
    categoryIds?: string[] | undefined;
    collectionProductIds?: string[] | undefined;
    isPublished?: boolean | undefined;
    gender?: string | string[] | undefined;
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
    search?: string | undefined;
    dynamicAttributes?: Record<string, any>;
}): any => {
    const {
        categoryIds,
        collectionProductIds,
        isPublished,
        gender,
        minPrice,
        maxPrice,
        search,
        dynamicAttributes,
    } = params;
    const where: any = {
        isPublished: true,
    };

    if (categoryIds) {
        where.categoryId = { in: categoryIds };
    } else if (categoryIds === undefined && params.categoryIds) {
        // Explicitly undefined categoryIds means invalid slug was passed
        // Logic handled in getCategoryIds to return undefined or throws?
        // Actually getCategoryIds returns string[] | undefined.
        // If I return empty array -> no match.
        // If I return undefined -> no filter.
    }

    if (collectionProductIds) {
        where.id = { in: collectionProductIds };
    }

    if (isPublished !== undefined) {
        where.isPublished = isPublished;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
        where.basePrice = {};
        if (minPrice !== undefined) where.basePrice.gte = Number(minPrice);
        if (maxPrice !== undefined) where.basePrice.lte = Number(maxPrice);
    }

    if (search) {
        where.OR = [
            { name: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
        ];
    }

    if (gender && gender !== "ALL") {
        const genders = Array.isArray(gender) ? gender : [gender];
        const validGenders = genders
            .map((g) => g.toUpperCase())
            .filter((g) => ["MEN", "WOMEN", "KIDS"].includes(g));

        if (validGenders.length > 0) {
            where.gender = {
                hasSome: validGenders,
            };
        }
    }

    if (dynamicAttributes) {
        Object.entries(dynamicAttributes).forEach(([key, value]) => {
            if (value) {
                const values = Array.isArray(value) ? value : [value.toString()];
                const attrConditions = values.map((v: string) => ({
                    attributes: {
                        path: [key],
                        equals: v,
                    },
                }));
                if (!where.AND) where.AND = [];
                where.AND.push({ OR: attrConditions });
            }
        });
    }

    return where;
};

export const buildSortOrder = (sortBy?: string): any => {
    const orderBy: any = {};
    switch (sortBy) {
        case "price_asc":
            orderBy.basePrice = "asc";
            break;
        case "price_desc":
            orderBy.basePrice = "desc";
            break;
        case "newest":
            orderBy.createdAt = "desc";
            break;
        case "rating":
            orderBy.overallRating = "desc";
            break;
        case "popularity":
            orderBy.reviewCount = "desc";
            break;
        default:
            orderBy.createdAt = "desc";
    }
    return orderBy;
};

export const buildPagination = (page: number, limit: number): { skip: number; take: number } => {
    return {
        skip: (page - 1) * limit,
        take: Number(limit),
    };
};
