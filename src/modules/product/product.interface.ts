import type {
    GetProductsQueryDto,
    GetProductsResponseDto,
    SearchProductsQueryDto,
    SearchProductsResponseDto,
    UpdateProductDto,
} from "./product.types.js";

export interface IProductService {
    getAllProducts(query: GetProductsQueryDto, userId?: string): Promise<GetProductsResponseDto>;
    getProductById(productId: string, userId?: string): Promise<any>;
    searchProducts(
        query: SearchProductsQueryDto,
        userId?: string
    ): Promise<SearchProductsResponseDto>;
    createProduct(data: any): Promise<any>;
    updateProduct(productId: string, data: UpdateProductDto): Promise<any>;
    deleteProduct(productId: string): Promise<void>;
}
