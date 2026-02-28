import type {
    GetProductsQueryDto,
    GetProductsResponseDto,
    SearchProductsQueryDto,
    SearchProductsResponseDto,
    SearchProductResultDto,
} from "./product.types.js";
import type { IProductService } from "./product.interface.js";
import { PrismaService } from "../../core/services/index.js";
import { NotFoundError } from "../../core/errors/http-errors.js";
import {
    getCategoryIds,
    getCollectionProductIds,
    getAvailableFilters,
    buildFilterConditions,
    buildSortOrder,
    buildPagination,
} from "./helpers/get-all-products.js";

export class ProductService implements IProductService {
    private prisma: PrismaService = new PrismaService();

    async getProductById(productId: string, userId?: string): Promise<any> {
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
            include: {
                variants: {
                    include: {
                        images: true,
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
            isPublished,
            gender,
            minPrice,
            maxPrice,
            search,
            sortBy,
            page = 1,
            limit = 20,
            ...dynamicAttributes
        } = query;

        // 1. Prepare Data for Filters
        const [categoryIds, collectionProductIds] = await Promise.all([
            getCategoryIds(this.prisma.getClient(), categorySlug, categoryId),
            getCollectionProductIds(this.prisma.getClient(), collectionSlug, collectionId),
        ]);

        // 2. Build Query Parts
        const where = buildFilterConditions({
            categoryIds: categoryIds || undefined,
            collectionProductIds: collectionProductIds || undefined,
            isPublished: isPublished !== undefined ? String(isPublished) === "true" : undefined,
            gender: gender || undefined,
            minPrice: minPrice || undefined,
            maxPrice: maxPrice || undefined,
            search: search || undefined,
            dynamicAttributes: dynamicAttributes || undefined,
        });

        const orderBy = buildSortOrder(sortBy);
        const { skip, take } = buildPagination(Number(page), Number(limit));

        // 3. Execute Query
        const [total, products] = await Promise.all([
            this.prisma.getClient().product.count({ where }),
            this.prisma.getClient().product.findMany({
                where,
                orderBy,
                skip,
                take,
                include: {
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
                                where: {
                                    isPrimary: true,
                                },
                                take: 1,
                            },
                        },
                    },
                },
            }),
        ]);

        // 4. Get Available Filters
        const availableFilters = await getAvailableFilters(
            this.prisma.getClient(),
            categorySlug,
            categoryId,
            products.length > 0
        );

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
                inStock: p.variants.some((v) => v.stockQty > 0),
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

    async searchProducts(
        query: SearchProductsQueryDto,
        userId?: string
    ): Promise<SearchProductsResponseDto> {
        const { q, limit = 10 } = query;

        if (!q || q.trim().length === 0) {
            return { success: true, query: q ?? "", count: 0, products: [] };
        }

        const searchTerm = q.trim();

        const products = (await this.prisma.getClient().product.findMany({
            where: {
                isPublished: true,
                OR: [
                    { name: { contains: searchTerm, mode: "insensitive" } },
                    { description: { contains: searchTerm, mode: "insensitive" } },
                ],
            },
            take: Number(limit),
            orderBy: { overallRating: "desc" },
            include: {
                variants: {
                    select: {
                        id: true,
                        basePrice: true,
                        originalPrice: true,
                        stockQty: true,
                        isDefault: true,
                        images: {
                            where: { isPrimary: true },
                            take: 1,
                            select: { imageUrl: true },
                        },
                    },
                },
            },
        })) as any[];

        // Optionally enrich with wishlist info
        let wishlistedVariantIds = new Set<string>();
        if (userId && products.length > 0) {
            const allVariantIds = products.flatMap((p: any) => p.variants.map((v: any) => v.id));
            const wishlisted = await this.prisma.getClient().wishlist.findMany({
                where: { userId, variantId: { in: allVariantIds } },
                select: { variantId: true },
            });
            wishlistedVariantIds = new Set(wishlisted.map((w) => w.variantId));
        }

        const mappedProducts: SearchProductResultDto[] = products.map((p: any) => {
            const defaultVariant = p.variants.find((v: any) => v.isDefault) ?? p.variants[0];
            const result: SearchProductResultDto = {
                id: p.id,
                name: p.name,
                slug: p.id,
                price: Number(defaultVariant?.basePrice ?? 0),
                primaryImage: defaultVariant?.images[0]?.imageUrl,
                variantId: defaultVariant?.id,
                isWishlisted: defaultVariant ? wishlistedVariantIds.has(defaultVariant.id) : false,
                inStock: p.variants.some((v: any) => v.stockQty > 0),
                rating: Number(p.overallRating),
                reviewCount: p.reviewCount,
            };
            if (defaultVariant?.originalPrice) {
                result.originalPrice = Number(defaultVariant.originalPrice);
            }
            return result;
        });

        return {
            success: true,
            query: searchTerm,
            count: mappedProducts.length,
            products: mappedProducts,
        };
    }
}
