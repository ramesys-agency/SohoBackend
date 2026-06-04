import { prisma } from "../../config/prisma.js";

export class HomePromoService {
    private prisma = prisma;

    async getHomePromos(query?: { isActive?: boolean }) {
        const client = this.prisma.getClient();
        
        // Auto-seed if count is not exactly 4
        const count = await client.homePromo.count();
        if (count !== 4) {
            await client.homePromo.deleteMany({}); // Clean up any invalid count/duplicate records
            
            const collections = await client.collection.findMany();
            const defaultCol = collections.find(c => c.slug === "trending-now") || collections[0] || null;
            
            const DEFAULT_PROMOS = [
                {
                    title: "Women Fashionable Top",
                    description: "This dress embodies sustainable fashion practices, woven from eco-friendly materials and produced with ethical craftsmanship.",
                    contentType: "COLLECTION",
                    collectionId: defaultCol?.id || null,
                    imageUrl: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?q=80&w=800&auto=format&fit=crop",
                    isActive: true,
                },
                {
                    title: "Fashionable Dress",
                    description: "This dress embodies sustainable fashion practices, woven from eco-friendly materials and produced with ethical craftsmanship.",
                    contentType: "COLLECTION",
                    collectionId: defaultCol?.id || null,
                    imageUrl: "https://images.unsplash.com/photo-1529139574466-a303027c1d8b?q=80&w=687&auto=format&fit=crop",
                    isActive: true,
                },
                {
                    title: "Luxurious Gown",
                    description: "This dress embodies sustainable fashion practices, woven from eco-friendly materials and produced with ethical craftsmanship.",
                    contentType: "COLLECTION",
                    collectionId: defaultCol?.id || null,
                    imageUrl: "https://images.unsplash.com/photo-1566174053879-31528523f8ae?q=80&w=800&auto=format&fit=crop",
                    isActive: true,
                },
                {
                    title: "Fashionable Heals",
                    description: "This dress embodies sustainable fashion practices, woven from eco-friendly materials and produced with ethical craftsmanship.",
                    contentType: "COLLECTION",
                    collectionId: defaultCol?.id || null,
                    imageUrl: "https://images.unsplash.com/photo-1543163521-1bf539c55dd2?q=80&w=800&auto=format&fit=crop",
                    isActive: true,
                },
            ];

            for (const promo of DEFAULT_PROMOS) {
                await client.homePromo.create({
                    data: promo
                });
            }
        }

        const where: any = {};
        if (query?.isActive !== undefined) {
            where.isActive = query.isActive;
        }

        const data = await client.homePromo.findMany({
            where,
            include: {
                product: {
                    include: {
                        variants: {
                            where: { isDefault: true },
                            include: { images: true }
                        }
                    }
                },
                collection: {
                    include: {
                        products: {
                            take: 3,
                            include: {
                                product: {
                                    include: {
                                        variants: {
                                            where: { isDefault: true },
                                            include: { images: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            orderBy: {
                createdAt: "asc"
            }
        });

        return {
            success: true,
            data
        };
    }

    async getHomePromoById(id: string) {
        const data = await this.prisma.getClient().homePromo.findUnique({
            where: { id },
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

        if (!data) {
            throw new Error("Home Promo not found");
        }

        return {
            success: true,
            data
        };
    }

    async createHomePromo(payload: {
        title: string;
        description: string;
        contentType: string;
        productId: string | null;
        collectionId: string | null;
        imageUrl: string | null;
        isActive: boolean;
    }) {
        const client = this.prisma.getClient();
        const result = await client.homePromo.create({
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

        return {
            success: true,
            data: result,
            message: "Home Promo created successfully"
        };
    }

    async updateHomePromo(id: string, payload: {
        title?: string;
        description?: string;
        contentType?: string;
        productId?: string | null;
        collectionId?: string | null;
        imageUrl?: string | null;
        isActive?: boolean;
    }) {
        const client = this.prisma.getClient();
        
        const existing = await client.homePromo.findUnique({
            where: { id }
        });

        if (!existing) {
            throw new Error("Home Promo not found");
        }

        const result = await client.homePromo.update({
            where: { id },
            data: {
                title: payload.title !== undefined ? payload.title : existing.title,
                description: payload.description !== undefined ? payload.description : existing.description,
                contentType: payload.contentType !== undefined ? payload.contentType : existing.contentType,
                productId: payload.contentType === "PRODUCT" ? (payload.productId ?? null) : (payload.contentType === undefined && existing.contentType === "PRODUCT" ? existing.productId : null),
                collectionId: payload.contentType === "COLLECTION" ? (payload.collectionId ?? null) : (payload.contentType === undefined && existing.contentType === "COLLECTION" ? existing.collectionId : null),
                imageUrl: payload.imageUrl !== undefined ? payload.imageUrl : existing.imageUrl,
                isActive: payload.isActive !== undefined ? payload.isActive : existing.isActive,
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

        return {
            success: true,
            data: result,
            message: "Home Promo updated successfully"
        };
    }

    async deleteHomePromo(id: string) {
        const client = this.prisma.getClient();
        
        const existing = await client.homePromo.findUnique({
            where: { id }
        });

        if (!existing) {
            throw new Error("Home Promo not found");
        }

        await client.homePromo.delete({
            where: { id }
        });

        return {
            success: true,
            message: "Home Promo deleted successfully"
        };
    }
}
