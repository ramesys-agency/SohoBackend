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
    placementId?: string;
    gender?: string | string[];
    /** `"all"` includes drafts — the admin list, not the storefront. */
    isPublished?: boolean | "all";
    minPrice?: number;
    maxPrice?: number;
    size?: string | string[];
    color?: string | string[];
    inStock?: boolean;
    search?: string;
    sortBy?:
        | "relevance"
        | "price_asc"
        | "price_desc"
        | "newest"
        | "oldest"
        | "createdAt_asc"
        | "createdAt_desc"
        | "name_asc"
        | "name_desc"
        | "rating"
        | "popularity";
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
    category: {
        id: string;
        name: string;
        slug: string;
    };
    gender: string[];
    createdAt: Date;
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
    q?: string;
    limit?: number;
    page?: number;
    categoryId?: string;
    categorySlug?: string;
    gender?: string | string[];
    minPrice?: number;
    maxPrice?: number;
    /** One size, a repeated key, or a comma-separated list. */
    size?: string | string[];
    /** Colour name or hex value, matched case-insensitively. */
    color?: string | string[];
    inStock?: boolean;
    sortBy?: "relevance" | "price_asc" | "price_desc" | "newest" | "rating" | "popularity";
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
    availableColors?: {
        colorName: string;
        colorValue: string;
    }[];
    category?: {
        id: string;
        name: string;
        slug: string;
    };
}

export interface SearchFacetsDto {
    categories: { id: string; name: string; slug: string; count: number }[];
    colors: { colorName: string; colorValue: string; count: number }[];
    sizes: { size: string; count: number }[];
    genders: { gender: string; count: number }[];
    priceRange: { min: number; max: number } | null;
}

export interface SearchProductsResponseDto {
    success: boolean;
    query: string;
    /** Set when no product matched every word and the search was widened. */
    widened?: boolean;
    /** Products on this page — kept for callers written against the old shape. */
    count: number;
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
    facets: SearchFacetsDto;
    products: SearchProductResultDto[];
}
