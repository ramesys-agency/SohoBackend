// --- Helpers ---

import type { PrismaClient } from "@prisma/client";
import { buildProductSearchWhere } from "./product-search.js";

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

// A placement's products are resolved by AppPlacementService.resolveProductIds:
// reading the rows directly would miss category-sourced placements, whose rows
// are overrides rather than the list itself.

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

export const getCategoryDescendants = async (
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

/** Query strings arrive as a single value, a repeated key, or a CSV list. */
const toList = (value: string | string[] | undefined): string[] => {
    if (value === undefined || value === null) return [];
    const raw = Array.isArray(value) ? value : String(value).split(",");
    return raw.map((v) => v.trim()).filter(Boolean);
};

export const buildFilterConditions = (params: {
    categoryIds?: string[] | undefined;
    collectionProductIds?: string[] | undefined;
    /** `"all"` drops the filter entirely — the admin list needs drafts too. */
    isPublished?: boolean | "all" | undefined;
    gender?: string | string[] | undefined;
    minPrice?: number | undefined;
    maxPrice?: number | undefined;
    size?: string | string[] | undefined;
    color?: string | string[] | undefined;
    inStock?: boolean | undefined;
    search?: string | undefined;
    /** Widen a search that found nothing: any word may match instead of all. */
    matchAllSearchTokens?: boolean | undefined;
    dynamicAttributes?: Record<string, any>;
}): any => {
    const {
        categoryIds,
        collectionProductIds,
        isPublished,
        gender,
        minPrice,
        maxPrice,
        size,
        color,
        inStock,
        search,
        matchAllSearchTokens = true,
        dynamicAttributes,
    } = params;
    // Soft-deleted products are gone as far as every caller is concerned.
    const where: any = {
        isPublished: true,
        deletedAt: null,
    };

    if (categoryIds) {
        where.categoryId = { in: categoryIds };
    }

    if (collectionProductIds) {
        where.id = { in: collectionProductIds };
    }

    if (isPublished === "all") {
        delete where.isPublished;
    } else if (isPublished !== undefined) {
        where.isPublished = isPublished;
    }

    // Price, size and colour live on the variant, and they have to hold on the
    // *same* variant: a red L and a blue M is not a match for "red, M".
    const variantWhere: any = {};
    if (minPrice !== undefined || maxPrice !== undefined) {
        variantWhere.basePrice = {};
        if (minPrice !== undefined) variantWhere.basePrice.gte = Number(minPrice);
        if (maxPrice !== undefined) variantWhere.basePrice.lte = Number(maxPrice);
    }
    const sizes = toList(size);
    if (sizes.length > 0) {
        variantWhere.size = { in: sizes, mode: "insensitive" };
    }
    const colors = toList(color);
    if (colors.length > 0) {
        variantWhere.OR = [
            { colorName: { in: colors, mode: "insensitive" } },
            { colorValue: { in: colors, mode: "insensitive" } },
        ];
    }
    // Reservations held by shoppers mid-checkout are subtracted when the
    // response is built; this only drops variants with nothing on the shelf.
    if (inStock) {
        variantWhere.stockQty = { gt: 0 };
    }
    if (Object.keys(variantWhere).length > 0) {
        where.variants = { some: variantWhere };
    }

    const searchWhere = buildProductSearchWhere(search, { matchAll: matchAllSearchTokens });
    if (searchWhere) {
        if (!where.AND) where.AND = [];
        where.AND.push(searchWhere);
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

/**
 * Sorts the database can do on its own. Price lives on the variants, so
 * `price_asc`/`price_desc` are ranked by the service instead — see
 * `buildPriceOrderedIds`.
 */
export const buildSortOrder = (sortBy?: string): any => {
    const orderBy: any = {};
    switch (sortBy) {
        case "newest":
        case "createdAt_desc":
            orderBy.createdAt = "desc";
            break;
        case "oldest":
        case "createdAt_asc":
            orderBy.createdAt = "asc";
            break;
        case "name_asc":
            orderBy.name = "asc";
            break;
        case "name_desc":
            orderBy.name = "desc";
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

export const isPriceSort = (sortBy?: string): sortBy is "price_asc" | "price_desc" =>
    sortBy === "price_asc" || sortBy === "price_desc";

/**
 * Product ids ordered by their cheapest variant. Prisma cannot order a product
 * by an aggregate over its variants, so the matching ids are ranked here; the
 * caller then hydrates only the page it needs.
 */
export const buildPriceOrderedIds = async (
    prisma: PrismaClient,
    productIds: string[],
    direction: "asc" | "desc"
): Promise<string[]> => {
    if (productIds.length === 0) return [];

    const grouped = await prisma.productVariant.groupBy({
        by: ["productId"],
        where: { productId: { in: productIds } },
        _min: { basePrice: true },
    });

    const priceOf = new Map(grouped.map((g) => [g.productId, Number(g._min.basePrice ?? 0)]));

    // A product with no variants has no price; it sorts last either way.
    const fallback = direction === "asc" ? Number.MAX_SAFE_INTEGER : -1;

    return [...productIds].sort((a, b) => {
        const priceA = priceOf.get(a) ?? fallback;
        const priceB = priceOf.get(b) ?? fallback;
        return direction === "asc" ? priceA - priceB : priceB - priceA;
    });
};

export const buildPagination = (page: number, limit: number): { skip: number; take: number } => {
    return {
        skip: (page - 1) * limit,
        take: Number(limit),
    };
};
