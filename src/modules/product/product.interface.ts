import type { GetProductsQueryDto, GetProductsResponseDto } from "./product.types.js";

export interface IProductService {
    getAllProducts(query: GetProductsQueryDto): Promise<GetProductsResponseDto>;
}
