import type { GetProductsQueryDto, GetProductsResponseDto } from "./product.types.js";

export interface IProductService {
    getAllProducts(query: GetProductsQueryDto, userId?: string): Promise<GetProductsResponseDto>;
    getProductById(productId: string, userId?: string): Promise<any>;
}
