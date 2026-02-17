export interface CreateProductDto {
    name: string;
    description: string;
    price: number;
    stock: number;
    image: string;
    category: string;
    brand: string;
    rating: number;
    numReviews: number;
    isFeatured: boolean;
    banner: string;
}

export interface UpdateProductDto {
    name?: string;
    description?: string;
    price?: number;
    stock?: number;
    image?: string;
    category?: string;
    brand?: string;
    rating?: number;
    numReviews?: number;
    isFeatured?: boolean;
    banner?: string;
}

export interface GetProductsQueryDto {
    categorySlug?: string;
    collectionSlug?: string;
    gender?: string | string[];
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
    availableColors: {
        colorName: string;
        colorValue: string;
    }[];
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
