import { prisma } from "../../config/prisma.js";

export class HomePromoService {
    private prisma = prisma;

    async getHomePromo() {
        const data = await this.prisma.getClient().homePromo.findFirst({
            include: {
                product: {
                    include: {
                        variants: {
                            where: { isDefault: true },
                            include: { images: true }
                        }
                    }
                },
                collection: true
            }
        });

        return {
            success: true,
            data: data || null
        };
    }

    async updateHomePromo(payload: {
        title: string;
        description: string;
        contentType: string;
        productId: string | null;
        collectionId: string | null;
        imageUrl: string | null;
        isActive: boolean;
    }) {
        const client = this.prisma.getClient();
        
        // Find existing configuration
        const existing = await client.homePromo.findFirst();

        let result;
        if (existing) {
            result = await client.homePromo.update({
                where: { id: existing.id },
                data: {
                    title: payload.title,
                    description: payload.description,
                    contentType: payload.contentType,
                    productId: payload.contentType === "PRODUCT" ? (payload.productId ?? null) : null,
                    collectionId: payload.contentType === "COLLECTION" ? (payload.collectionId ?? null) : null,
                    imageUrl: (payload.imageUrl !== undefined ? payload.imageUrl : existing.imageUrl) ?? null,
                    isActive: payload.isActive ?? existing.isActive,
                },
                include: {
                    product: {
                        include: {
                            variants: {
                                where: { isDefault: true },
                                include: { images: true }
                            }
                        }
                    },
                    collection: true
                }
            });
        } else {
            result = await client.homePromo.create({
                data: {
                    title: payload.title,
                    description: payload.description,
                    contentType: payload.contentType,
                    productId: payload.contentType === "PRODUCT" ? (payload.productId ?? null) : null,
                    collectionId: payload.contentType === "COLLECTION" ? (payload.collectionId ?? null) : null,
                    imageUrl: payload.imageUrl ?? null,
                    isActive: payload.isActive ?? true,
                },
                include: {
                    product: {
                        include: {
                            variants: {
                                where: { isDefault: true },
                                include: { images: true }
                            }
                        }
                    },
                    collection: true
                }
            });
        }

        return {
            success: true,
            data: result,
            message: "Home Promo section updated successfully"
        };
    }
}
