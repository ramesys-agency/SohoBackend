import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type {
    GetProductsQueryDto,
    GetProductsResponseDto,
    SearchProductsQueryDto,
    SearchProductsResponseDto,
    SearchProductResultDto,
    CreateProductDto,
    UpdateProductDto,
} from "./product.types.js";
import type { IProductService } from "./product.interface.js";
import { PrismaService } from "../../core/services/index.js";
import { NotFoundError } from "../../core/errors/http-errors.js";
import { CheckoutService } from "../checkout/checkout.service.js";
import {
    getCategoryIds,
    getCollectionProductIds,
    getAvailableFilters,
    buildFilterConditions,
    buildSortOrder,
    buildPagination,
    buildPriceOrderedIds,
    isPriceSort,
} from "./helpers/get-all-products.js";
import {
    buildSearchFacets,
    rankBySearchRelevance,
    tokenize,
    SEARCH_CANDIDATE_LIMIT,
} from "./helpers/product-search.js";
import { AppPlacementService } from "../app-placement/app-placement.service.js";

/** The one image that stands for a variant in a list. */
const THUMBNAIL_ORDER: Prisma.ProductVariantImageOrderByWithRelationInput[] = [
    { isPrimary: "desc" },
    { displayOrder: "asc" },
    { createdAt: "asc" },
];

export class ProductService implements IProductService {
    private prisma: PrismaService = prisma;
    private checkout: CheckoutService = new CheckoutService();
    private placements: AppPlacementService = new AppPlacementService();

    /**
     * Units a shopper can actually buy right now: stock on hand minus every
     * live checkout hold. One grouped query covers a whole response, so a
     * product list costs one extra round trip, not one per variant.
     */
    private async getAvailability(variantIds: string[]): Promise<Map<string, number>> {
        if (!variantIds.length) return new Map();
        return await this.checkout.getReservedQuantities(this.prisma.getClient(), variantIds);
    }

    async createProduct(data: CreateProductDto): Promise<any> {
        return await this.prisma.getClient().$transaction(async (tx) => {
            // 1. Validate Category
            const category = await tx.category.findUnique({
                where: { id: data.categoryId },
            });
            if (!category) {
                throw new NotFoundError("Category not found");
            }

            // 2. Create Base Product
            const createdProduct = await tx.product.create({
                data: {
                    name: data.name,
                    description: data.description || null,
                    categoryId: data.categoryId,
                    attributes: data.attributes,
                    gender: data.gender || [],
                    isPublished: data.isPublished || false,
                },
            });

            // 3. Create ProductCollections
            if (data.collectionIds && data.collectionIds.length > 0) {
                // Determine order or logic if necessary, here we just insert.
                const productCollectionsData = data.collectionIds.map((collectionId) => ({
                    productId: createdProduct.id,
                    collectionId: collectionId,
                }));

                await tx.productCollection.createMany({
                    data: productCollectionsData,
                    skipDuplicates: true, // in case of duplicate IDs
                });
            }

            // 4. Create Variants and Associated Data (Images)
            for (const variant of data.variants) {
                if (variant.basePrice === undefined || variant.basePrice === null) {
                    throw new Error("Variant basePrice is required");
                }

                await tx.productVariant.create({
                    data: {
                        productId: createdProduct.id,
                        sku: variant.sku,
                        size: variant.size || null,
                        colorName: variant.colorName || null,
                        colorValue: variant.colorValue || null,
                        stockQty: variant.stockQty || 0,
                        basePrice: variant.basePrice,
                        originalPrice: variant.originalPrice || null,
                        isDefault: variant.isDefault || false,
                        images: {
                            create: variant.images.map((image) => ({
                                imageUrl: image.imageUrl,
                                isPrimary: image.isPrimary || false,
                                displayOrder: image.displayOrder || 0,
                                colorRef: image.colorRef || null,
                            })),
                        },
                    },
                });
            }

            // 5. Build Initial Price History
            const defaultVariant = data.variants.find((v) => v.isDefault) || data.variants[0];
            await tx.productPriceHistory.create({
                data: {
                    productId: createdProduct.id,
                    price: defaultVariant?.basePrice ?? 0,
                    effectiveFrom: new Date(),
                },
            });

            return createdProduct;
        });
    }

    async getProductById(productId: string, userId?: string): Promise<any> {
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
            include: {
                variants: {
                    include: {
                        // The admin arranges these by hand, so hand them back in
                        // that order rather than whatever the table returns.
                        images: {
                            orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }],
                        },
                    },
                },
                reviews: {
                    include: {
                        user: {
                            select: {
                                fullName: true,
                            },
                        },
                    },
                },
            },
        });

        if (!product) {
            throw new NotFoundError("Product not found");
        }

        // Units held by shoppers who are mid-checkout are not for sale, so the
        // app sees them as gone rather than letting a customer start a checkout
        // that is guaranteed to fail.
        const reserved = await this.getAvailability(product.variants.map((v) => v.id));
        product.variants = product.variants.map((v) => ({
            ...v,
            availableQty: Math.max(0, v.stockQty - (reserved.get(v.id) ?? 0)),
        })) as typeof product.variants;

        if (userId) {
            const variantIds = product.variants.map((v) => v.id);
            const [wishlistedItems, cartItems] = await Promise.all([
                this.prisma.getClient().wishlist.findMany({
                    where: {
                        userId,
                        variantId: { in: variantIds },
                    },
                }),
                this.prisma.getClient().cartItem.findMany({
                    where: {
                        userId,
                        variantId: { in: variantIds },
                    },
                }),
            ]);

            const wishlistedVariantIds = new Set(wishlistedItems.map((w) => w.variantId));
            const cartVariantIds = new Set(cartItems.map((c) => c.variantId));

            product.variants = product.variants.map((v) => ({
                ...v,
                isWishlisted: wishlistedVariantIds.has(v.id) || false,
                isAddedToCart: cartVariantIds.has(v.id) || false,
            }));
        }

        return product;
    }

    async getAllProducts(
        query: GetProductsQueryDto,
        userId?: string
    ): Promise<GetProductsResponseDto> {
        const {
            categoryId,
            categorySlug,
            collectionId,
            collectionSlug,
            placementId,
            isPublished,
            gender,
            minPrice,
            maxPrice,
            size,
            color,
            inStock,
            search,
            sortBy,
            page = 1,
            limit = 20,
            ...dynamicAttributes
        } = query;

        // 1. Prepare Data for Filters
        // placementId takes priority: return only the products that placement
        // resolves to — hand-picked rows, or a category's live list with the
        // admin's overrides applied.
        const [categoryIds, collectionProductIds] = await Promise.all([
            getCategoryIds(this.prisma.getClient(), categorySlug, categoryId),
            placementId
                ? this.placements.resolveProductIds(placementId)
                : getCollectionProductIds(this.prisma.getClient(), collectionSlug, collectionId),
        ]);

        // 2. Build Query Parts
        // `isPublished=all` is how the admin list asks for drafts alongside
        // live products; the storefront never sends it and stays published-only.
        const publishedFilter =
            isPublished === undefined
                ? undefined
                : String(isPublished) === "all"
                  ? ("all" as const)
                  : String(isPublished) === "true";

        const filters = {
            categoryIds: categoryIds || undefined,
            collectionProductIds: collectionProductIds || undefined,
            isPublished: publishedFilter,
            gender: gender || undefined,
            minPrice: minPrice !== undefined ? Number(minPrice) : undefined,
            maxPrice: maxPrice !== undefined ? Number(maxPrice) : undefined,
            size: size || undefined,
            color: color || undefined,
            inStock: inStock !== undefined ? String(inStock) === "true" : undefined,
            search: search || undefined,
            dynamicAttributes: dynamicAttributes || undefined,
        };

        const where = buildFilterConditions(filters);

        const orderBy = buildSortOrder(sortBy);
        const { skip, take } = buildPagination(Number(page), Number(limit));

        // 3. Execute Query
        const listInclude = {
            category: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                },
            },
            variants: {
                select: {
                    id: true,
                    colorName: true,
                    colorValue: true,
                    stockQty: true,
                    basePrice: true,
                    originalPrice: true,
                    isDefault: true,
                    images: {
                        // Prefer the primary image, but a variant whose rows
                        // predate that flag still deserves a thumbnail.
                        orderBy: THUMBNAIL_ORDER,
                        take: 1,
                    },
                },
            },
        };

        const client = this.prisma.getClient();

        // Every read of the list goes through here so the include — and so the
        // inferred row type, relations and all — stays in one place.
        const findProducts = (args: {
            where: typeof where | { id: { in: string[] } };
            orderBy?: typeof orderBy;
            skip?: number;
            take?: number;
        }) => client.product.findMany({ ...args, include: listInclude });

        // A placement's product list is a running order the admin arranged by
        // hand, so when one is requested without an explicit sort, paginate
        // over that order instead of letting the default createdAt sort
        // scramble it. Ordering in the database would need a CASE over every
        // id, so the ids are ranked here and only one page is hydrated.
        const placementOrder = placementId && !sortBy ? (collectionProductIds ?? []) : null;

        // Three orders cannot be expressed as a Prisma `orderBy`: a placement's
        // hand-arranged list, cheapest-variant price, and search relevance. Each
        // ranks the matching ids here and only the requested page is hydrated.
        const resolveOrderedIds = async (
            filterWhere: typeof where
        ): Promise<string[] | null> => {
            if (placementOrder) {
                const rank = new Map(placementOrder.map((id, index) => [id, index]));
                const matching = await client.product.findMany({
                    where: filterWhere,
                    select: { id: true },
                });
                return matching
                    .map((p) => p.id)
                    .sort(
                        (a, b) =>
                            (rank.get(a) ?? Number.MAX_SAFE_INTEGER) -
                            (rank.get(b) ?? Number.MAX_SAFE_INTEGER)
                    );
            }

            if (isPriceSort(sortBy)) {
                const matching = await client.product.findMany({
                    where: filterWhere,
                    select: { id: true },
                });
                return buildPriceOrderedIds(
                    client,
                    matching.map((p) => p.id),
                    sortBy === "price_asc" ? "asc" : "desc"
                );
            }

            // Searching without an explicit sort means "best match first".
            if (search && (!sortBy || sortBy === "relevance")) {
                const candidates = await client.product.findMany({
                    where: filterWhere,
                    take: SEARCH_CANDIDATE_LIMIT,
                    orderBy: { overallRating: "desc" },
                    select: {
                        id: true,
                        name: true,
                        description: true,
                        overallRating: true,
                        reviewCount: true,
                        category: { select: { name: true } },
                        variants: { select: { sku: true, colorName: true, size: true } },
                    },
                });
                return rankBySearchRelevance(candidates, search).map((p) => p.id);
            }

            return null;
        };

        const runQuery = async (filterWhere: typeof where) => {
            const orderedIds = await resolveOrderedIds(filterWhere);

            if (orderedIds) {
                const rank = new Map(orderedIds.map((id, index) => [id, index]));
                const pageIds = orderedIds.slice(skip, skip + take);
                const rows =
                    pageIds.length === 0
                        ? []
                        : await findProducts({ where: { id: { in: pageIds } } });

                return {
                    // Ranked ids are the whole result set (relevance caps the
                    // pool at SEARCH_CANDIDATE_LIMIT), so they also give the total.
                    total: orderedIds.length,
                    products: rows.sort(
                        (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0)
                    ),
                };
            }

            const [total, products] = await Promise.all([
                client.product.count({ where: filterWhere }),
                findProducts({ where: filterWhere, orderBy, skip, take }),
            ]);
            return { total, products };
        };

        let { total, products } = await runQuery(where);

        // A multi-word search that matches nothing is usually one word too
        // specific ("navy linen shirt" when the colour is "Midnight"). Rather
        // than show an empty screen, fall back to matching any of the words.
        if (total === 0 && search && tokenize(search).length > 1) {
            ({ total, products } = await runQuery(
                buildFilterConditions({ ...filters, matchAllSearchTokens: false })
            ));
        }

        // 4. Get Available Filters
        const availableFilters = await getAvailableFilters(
            this.prisma.getClient(),
            categorySlug,
            categoryId,
            products.length > 0
        );

        // Live checkout holds make an item unavailable to everyone else.
        const reserved = await this.getAvailability(
            products.flatMap((p) => p.variants.map((v) => v.id))
        );
        const availableQty = (variant: { id: string; stockQty: number }) =>
            variant.stockQty - (reserved.get(variant.id) ?? 0);

        let wishlistedVariantIds = new Set<string>();
        let cartVariantIds = new Set<string>();
        if (userId && products.length > 0) {
            const allVariantIds = products.flatMap((p) => p.variants.map((v) => v.id));
            const [wishlistedItems, cartItems] = await Promise.all([
                this.prisma.getClient().wishlist.findMany({
                    where: {
                        userId,
                        variantId: { in: allVariantIds },
                    },
                }),
                this.prisma.getClient().cartItem.findMany({
                    where: {
                        userId,
                        variantId: { in: allVariantIds },
                    },
                }),
            ]);
            wishlistedVariantIds = new Set(wishlistedItems.map((w) => w.variantId));
            cartVariantIds = new Set(cartItems.map((c) => c.variantId));
        }

        // 5. Map Response
        const mappedProducts = products.map((p) => {
            const defaultVariant = p.variants.find((v) => v.isDefault) || p.variants[0];
            const colorMap = new Map();
            p.variants.forEach((v) => {
                if (v.colorName && v.colorValue) {
                    const key = `${v.colorName}-${v.colorValue}`;
                    if (!colorMap.has(key)) {
                        colorMap.set(key, {
                            colorName: v.colorName,
                            colorValue: v.colorValue,
                        });
                    }
                }
            });

            const productDto: any = {
                id: p.id,
                name: p.name,
                isPublished: p.isPublished,
                slug: p.id, // TODO: Add slug field to Product model if needed
                price: Number(defaultVariant?.basePrice),
                originalPrice: Number(defaultVariant?.originalPrice),
                rating: Number(p.overallRating),
                reviewCount: p.reviewCount,
                primaryImage:
                    defaultVariant?.images[0]?.imageUrl || p.variants[0]?.images[0]?.imageUrl,
                availableColors: Array.from(colorMap.values()),
                variantId: defaultVariant?.id,
                isWishlisted: defaultVariant ? wishlistedVariantIds.has(defaultVariant.id) : false,
                isAddedToCart: defaultVariant ? cartVariantIds.has(defaultVariant.id) : false,
                inStock: p.variants.some((v) => availableQty(v) > 0),
                category: p.category,
                gender: p.gender,
                createdAt: p.createdAt,
            };

            if (p.variants[0]?.originalPrice) {
                productDto.originalPrice = Number(p.variants[0]?.originalPrice);
            }

            return productDto;
        });

        return {
            success: true,
            pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                totalPages: Math.ceil(total / Number(limit)),
            },
            filters: {
                available: availableFilters,
                applied: { ...query },
            },
            products: mappedProducts,
        };
    }

    /**
     * The storefront's search: a query string, the filters the shopper picked,
     * and the facets that let them pick the next one. Results come back ranked
     * by relevance unless an explicit sort is asked for.
     */
    async searchProducts(
        query: SearchProductsQueryDto,
        userId?: string
    ): Promise<SearchProductsResponseDto> {
        const {
            q,
            limit = 20,
            page = 1,
            categoryId,
            categorySlug,
            gender,
            minPrice,
            maxPrice,
            size,
            color,
            inStock,
            sortBy,
        } = query;

        const searchTerm = (q ?? "").trim();
        const client = this.prisma.getClient();

        const hasFilter =
            Boolean(categoryId || categorySlug || gender || size || color || inStock) ||
            minPrice !== undefined ||
            maxPrice !== undefined;

        // Nothing typed and nothing picked is the search screen at rest: no
        // results to show, but the filter sheet still needs to know what the
        // catalogue is made of before the shopper can narrow it.
        if (!searchTerm && !hasFilter) {
            const catalogue = await client.product.findMany({
                where: buildFilterConditions({}),
                take: SEARCH_CANDIDATE_LIMIT,
                orderBy: { overallRating: "desc" },
                select: {
                    gender: true,
                    category: { select: { id: true, name: true, slug: true } },
                    variants: {
                        select: { size: true, colorName: true, colorValue: true, basePrice: true },
                    },
                },
            });

            return {
                success: true,
                query: "",
                count: 0,
                pagination: { page: 1, limit: Number(limit), total: 0, totalPages: 0 },
                facets: buildSearchFacets(catalogue),
                products: [],
            };
        }

        const categoryIds = await getCategoryIds(client, categorySlug, categoryId);

        const filters = {
            categoryIds: categoryIds || undefined,
            gender: gender || undefined,
            minPrice: minPrice !== undefined ? Number(minPrice) : undefined,
            maxPrice: maxPrice !== undefined ? Number(maxPrice) : undefined,
            size: size || undefined,
            color: color || undefined,
            inStock: inStock !== undefined ? String(inStock) === "true" : undefined,
            search: searchTerm || undefined,
        };

        const candidateSelect = {
            id: true,
            name: true,
            description: true,
            gender: true,
            overallRating: true,
            reviewCount: true,
            createdAt: true,
            category: { select: { id: true, name: true, slug: true } },
            variants: {
                select: {
                    id: true,
                    sku: true,
                    size: true,
                    colorName: true,
                    colorValue: true,
                    stockQty: true,
                    basePrice: true,
                    originalPrice: true,
                    isDefault: true,
                    images: { orderBy: THUMBNAIL_ORDER, take: 1, select: { imageUrl: true } },
                },
            },
        };

        // Relevance and cheapest-variant price both need the matches in hand, so
        // a bounded pool is pulled once and ranked, sliced and counted here.
        const fetchCandidates = (matchAllSearchTokens: boolean) =>
            client.product.findMany({
                where: buildFilterConditions({ ...filters, matchAllSearchTokens }),
                take: SEARCH_CANDIDATE_LIMIT,
                orderBy: { overallRating: "desc" },
                select: candidateSelect,
            });

        let candidates = await fetchCandidates(true);

        // Same widening as the catalogue list: one word too many should not
        // leave the shopper staring at "no products found".
        let widened = false;
        if (candidates.length === 0 && searchTerm && tokenize(searchTerm).length > 1) {
            candidates = await fetchCandidates(false);
            widened = candidates.length > 0;
        }

        // Facets come from the query before the variant-level filters are
        // applied, otherwise picking "red" leaves red as the only colour on
        // offer and the shopper can never switch to blue.
        const hasVariantFilter =
            Boolean(size || color || inStock) || minPrice !== undefined || maxPrice !== undefined;
        const facetCandidates = hasVariantFilter
            ? await client.product.findMany({
                  where: buildFilterConditions({
                      ...filters,
                      minPrice: undefined,
                      maxPrice: undefined,
                      size: undefined,
                      color: undefined,
                      inStock: undefined,
                      matchAllSearchTokens: !widened,
                  }),
                  take: SEARCH_CANDIDATE_LIMIT,
                  orderBy: { overallRating: "desc" },
                  select: candidateSelect,
              })
            : candidates;

        const priceOf = (product: (typeof candidates)[number]): number => {
            const prices = product.variants.map((v) => Number(v.basePrice));
            return prices.length > 0 ? Math.min(...prices) : 0;
        };

        const sorted = (() => {
            switch (sortBy) {
                case "price_asc":
                    return [...candidates].sort((a, b) => priceOf(a) - priceOf(b));
                case "price_desc":
                    return [...candidates].sort((a, b) => priceOf(b) - priceOf(a));
                case "newest":
                    return [...candidates].sort(
                        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
                    );
                case "rating":
                    return [...candidates].sort(
                        (a, b) => Number(b.overallRating) - Number(a.overallRating)
                    );
                case "popularity":
                    return [...candidates].sort((a, b) => b.reviewCount - a.reviewCount);
                default:
                    // No query to rank against (filters only) keeps the
                    // rating order the database already applied.
                    return searchTerm ? rankBySearchRelevance(candidates, searchTerm) : candidates;
            }
        })();

        const total = sorted.length;
        const take = Math.max(1, Number(limit));
        const currentPage = Math.max(1, Number(page));
        const pageProducts = sorted.slice((currentPage - 1) * take, currentPage * take);

        const reserved = await this.getAvailability(
            pageProducts.flatMap((p) => p.variants.map((v) => v.id))
        );

        let wishlistedVariantIds = new Set<string>();
        if (userId && pageProducts.length > 0) {
            const variantIds = pageProducts.flatMap((p) => p.variants.map((v) => v.id));
            const wishlisted = await client.wishlist.findMany({
                where: { userId, variantId: { in: variantIds } },
                select: { variantId: true },
            });
            wishlistedVariantIds = new Set(wishlisted.map((w) => w.variantId));
        }

        const mappedProducts: SearchProductResultDto[] = pageProducts.map((p) => {
            const defaultVariant = p.variants.find((v) => v.isDefault) ?? p.variants[0];
            const colors = new Map<string, { colorName: string; colorValue: string }>();
            p.variants.forEach((v) => {
                if (v.colorName && v.colorValue) {
                    colors.set(`${v.colorName}-${v.colorValue}`, {
                        colorName: v.colorName,
                        colorValue: v.colorValue,
                    });
                }
            });

            const result: SearchProductResultDto = {
                id: p.id,
                name: p.name,
                slug: p.id,
                price: Number(defaultVariant?.basePrice ?? 0),
                ...(defaultVariant?.images[0]?.imageUrl && {
                    primaryImage: defaultVariant.images[0].imageUrl,
                }),
                ...(defaultVariant && { variantId: defaultVariant.id }),
                isWishlisted: defaultVariant ? wishlistedVariantIds.has(defaultVariant.id) : false,
                inStock: p.variants.some((v) => v.stockQty - (reserved.get(v.id) ?? 0) > 0),
                rating: Number(p.overallRating),
                reviewCount: p.reviewCount,
                availableColors: Array.from(colors.values()),
                ...(p.category && { category: p.category }),
            };
            if (defaultVariant?.originalPrice) {
                result.originalPrice = Number(defaultVariant.originalPrice);
            }
            return result;
        });

        return {
            success: true,
            query: searchTerm,
            ...(widened && { widened: true }),
            count: mappedProducts.length,
            pagination: {
                page: currentPage,
                limit: take,
                total,
                totalPages: Math.ceil(total / take),
            },
            // Facets describe everything the query matched, not just this page,
            // so the filter sheet offers options that lead somewhere.
            facets: buildSearchFacets(facetCandidates),
            products: mappedProducts,
        };
    }

    async updateProduct(productId: string, data: UpdateProductDto): Promise<any> {
        return await this.prisma.getClient().$transaction(async (tx) => {
            // 1. Check product exists
            const existing = await tx.product.findUnique({
                where: { id: productId },
            });
            if (!existing) {
                throw new NotFoundError("Product not found");
            }

            // 2. Validate Category if provided
            if (data.categoryId) {
                const category = await tx.category.findUnique({
                    where: { id: data.categoryId },
                });
                if (!category) {
                    throw new NotFoundError("Category not found");
                }
            }

            // 3. Update Base Product fields
            const updatedProduct = await tx.product.update({
                where: { id: productId },
                data: {
                    ...(data.name !== undefined && { name: data.name }),
                    ...(data.description !== undefined && { description: data.description }),
                    ...(data.categoryId !== undefined && { categoryId: data.categoryId }),
                    ...(data.attributes !== undefined && { attributes: data.attributes }),
                    ...(data.gender !== undefined && { gender: data.gender }),
                    ...(data.isPublished !== undefined && { isPublished: data.isPublished }),
                },
            });

            // 4. Update Collections (replace strategy)
            if (data.collectionIds !== undefined) {
                await tx.productCollection.deleteMany({ where: { productId } });
                if (data.collectionIds.length > 0) {
                    await tx.productCollection.createMany({
                        data: data.collectionIds.map((collectionId) => ({
                            productId,
                            collectionId,
                        })),
                        skipDuplicates: true,
                    });
                }
            }

            // 5. Upsert Variants (by SKU)
            if (data.variants && data.variants.length > 0) {
                for (const variant of data.variants) {
                    const existingVariant = await tx.productVariant.findUnique({
                        where: { sku: variant.sku },
                    });

                    if (existingVariant) {
                        // Update existing variant
                        await tx.productVariant.update({
                            where: { sku: variant.sku },
                            data: {
                                ...(variant.size !== undefined && { size: variant.size }),
                                ...(variant.colorName !== undefined && {
                                    colorName: variant.colorName,
                                }),
                                ...(variant.colorValue !== undefined && {
                                    colorValue: variant.colorValue,
                                }),
                                ...(variant.stockQty !== undefined && {
                                    stockQty: variant.stockQty,
                                }),
                                ...(variant.basePrice !== undefined && {
                                    basePrice: variant.basePrice,
                                }),
                                ...(variant.originalPrice !== undefined && {
                                    originalPrice: variant.originalPrice,
                                }),
                                ...(variant.isDefault !== undefined && {
                                    isDefault: variant.isDefault,
                                }),
                            },
                        });

                        // Replace images if provided
                        if (variant.images && variant.images.length > 0) {
                            await tx.productVariantImage.deleteMany({
                                where: { variantId: existingVariant.id },
                            });
                            await tx.productVariantImage.createMany({
                                data: variant.images.map((image) => ({
                                    variantId: existingVariant.id,
                                    imageUrl: image.imageUrl,
                                    isPrimary: image.isPrimary ?? false,
                                    displayOrder: image.displayOrder ?? 0,
                                    colorRef: image.colorRef ?? null,
                                })),
                            });
                        }
                    } else {
                        // Create new variant
                        await tx.productVariant.create({
                            data: {
                                productId,
                                sku: variant.sku,
                                size: variant.size ?? null,
                                colorName: variant.colorName ?? null,
                                colorValue: variant.colorValue ?? null,
                                stockQty: variant.stockQty ?? 0,
                                basePrice: variant.basePrice!,
                                originalPrice: variant.originalPrice ?? null,
                                isDefault: variant.isDefault ?? false,
                                images: {
                                    create: variant.images.map((image) => ({
                                        imageUrl: image.imageUrl,
                                        isPrimary: image.isPrimary ?? false,
                                        displayOrder: image.displayOrder ?? 0,
                                        colorRef: image.colorRef ?? null,
                                    })),
                                },
                            },
                        });
                    }
                }

                // 6. Record Price History if default variant base price changed
                const defaultVariant = data.variants.find((v) => v.isDefault) ?? data.variants[0];
                if (defaultVariant?.basePrice !== undefined) {
                    await tx.productPriceHistory.create({
                        data: {
                            productId,
                            price: defaultVariant.basePrice,
                            effectiveFrom: new Date(),
                        },
                    });
                }
            }

            return updatedProduct;
        });
    }

    async deleteProduct(productId: string): Promise<void> {
        const existing = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
        });

        if (!existing) {
            throw new NotFoundError("Product not found");
        }

        // Soft delete: set deletedAt timestamp
        await this.prisma.getClient().product.update({
            where: { id: productId },
            data: { deletedAt: new Date() },
        });
    }
}
