import type { GetProductsQueryDto, GetProductsResponseDto } from "./product.types.js";
import type { IProductService } from "./product.interface.js";
import { PrismaService } from "../../core/services/index.js";
import {
    getCategoryIds,
    getAvailableFilters,
    buildFilterConditions,
    buildSortOrder,
    buildPagination,
} from "./helpers/get-all-products.js";

export class ProductService implements IProductService {
    private prisma: PrismaService = new PrismaService();

    async getAllProducts(query: GetProductsQueryDto): Promise<GetProductsResponseDto> {
        const {
            categorySlug,
            collectionSlug,
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
        // 1. Prepare Data for Filters
        const categoryIds = await getCategoryIds(this.prisma.getClient(), categorySlug);

        // 2. Build Query Parts
        // 2. Build Query Parts
        const where = buildFilterConditions({
            categoryIds: categoryIds || undefined,
            collectionSlug: collectionSlug || undefined,
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
                    images: true,
                    variants: {
                        select: {
                            colorName: true,
                            colorValue: true,
                            stockQty: true,
                        },
                    },
                },
            }),
        ]);

        // 4. Get Available Filters
        // 4. Get Available Filters
        const availableFilters = await getAvailableFilters(
            this.prisma.getClient(),
            categorySlug,
            products.length > 0
        );

        // 5. Map Response
        const mappedProducts = products.map((p) => {
            const productDto: any = {
                id: p.id,
                name: p.name,
                slug: p.id, // TODO: Add slug field to Product model if needed
                price: Number(p.basePrice),
                originalPrice: Number(p.originalPrice),
                rating: Number(p.overallRating),
                reviewCount: p.reviewCount,
                primaryImage:
                    p.images.find((i) => i.isPrimary)?.imageUrl || p.images[0]?.imageUrl || "",
                availableColors: Array.from(
                    new Set(
                        p.variants.map((v) =>
                            JSON.stringify({ colorName: v.colorName, colorValue: v.colorValue })
                        )
                    )
                )
                    .map((s) => JSON.parse(s))
                    .filter((c) => c.colorName && c.colorValue),
                inStock: p.variants.some((v) => v.stockQty > 0),
            };

            if (p.originalPrice) {
                productDto.originalPrice = Number(p.originalPrice);
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
}
