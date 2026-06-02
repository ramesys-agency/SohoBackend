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
import {
    getCategoryIds,
    getCollectionProductIds,
    getPlacementProductIds,
    getAvailableFilters,
    buildFilterConditions,
    buildSortOrder,
    buildPagination,
} from "./helpers/get-all-products.js";

export class ProductService implements IProductService {
    private prisma: PrismaService = prisma;

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
            placementId,
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
        // placementId takes priority: return only products assigned to that specific placement
        const [categoryIds, collectionProductIds] = await Promise.all([
            getCategoryIds(this.prisma.getClient(), categorySlug, categoryId),
            placementId
                ? getPlacementProductIds(this.prisma.getClient(), placementId)
                : getCollectionProductIds(this.prisma.getClient(), collectionSlug, collectionId),
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
