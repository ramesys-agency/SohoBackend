import type {
    GetProductsQueryDto,
    GetProductsResponseDto,
    SearchProductsQueryDto,
    SearchProductsResponseDto,
} from "./product.types.js";

export interface IProductService {
    getAllProducts(query: GetProductsQueryDto, userId?: string): Promise<GetProductsResponseDto>;
    getProductById(productId: string, userId?: string): Promise<any>;
    searchProducts(
        query: SearchProductsQueryDto,
        userId?: string
    ): Promise<SearchProductsResponseDto>;
}
