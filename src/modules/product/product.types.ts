export interface CreateProductVariantImageDto {
    imageUrl: string;
    isPrimary?: boolean;
    displayOrder?: number;
    colorRef?: string;
}

export interface CreateProductVariantDto {
    sku: string;
    size?: string;
    colorName?: string;
    colorValue?: string;
    stockQty?: number;
    basePrice: number;
    originalPrice?: number;
    isDefault?: boolean;
    images: CreateProductVariantImageDto[];
}

export interface CreateProductDto {
    name: string;
    description?: string;
    categoryId: string;
    collectionIds?: string[]; // Array of UUIDs
    attributes: Record<string, any>;
    gender?: ("MEN" | "WOMEN" | "KIDS")[];
    isPublished?: boolean;
    variants: CreateProductVariantDto[];
}

export type UpdateProductDto = Partial<CreateProductDto>;

export interface GetProductsQueryDto {
    categoryId?: string;
    categorySlug?: string;
    collectionId?: string;
    collectionSlug?: string;
    gender?: string | string[];
    isPublished?: boolean;
    minPrice?: number;
    maxPrice?: number;
    search?: string;
    sortBy?: "price_asc" | "price_desc" | "newest" | "rating" | "popularity";
    page?: number;
    limit?: number;
    [key: string]: any; // For dynamic attribute filters
}

export interface ProductResponseDto {
    id: string;
    name: string;
    slug: string; // Assuming slug needs to be generated or added to schema if not present, but using ID for now or assuming name->slug
    price: number;
    originalPrice?: number;
    rating: number;
    reviewCount: number;
    primaryImage: string;
    isPublished: boolean;
    availableColors: {
        colorName: string;
        colorValue: string;
    }[];
    variantId?: string;
    isWishlisted?: boolean;
    inStock: boolean;
}

export interface FilterOption {
    key: string;
    label: string;
    options: string[];
}

export interface GetProductsResponseDto {
    success: boolean;
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    filters: {
        available: FilterOption[];
        applied: Record<string, any>;
    };
    products: ProductResponseDto[];
}

export interface SearchProductsQueryDto {
    q: string;
    limit?: number;
}

export interface SearchProductResultDto {
    id: string;
    name: string;
    slug: string;
    price: number;
    originalPrice?: number;
    primaryImage?: string;
    variantId?: string;
    isWishlisted?: boolean;
    inStock: boolean;
    rating: number;
    reviewCount: number;
}

export interface SearchProductsResponseDto {
    success: boolean;
    query: string;
    count: number;
    products: SearchProductResultDto[];
}
