import { PrismaService } from "../../core/services/index.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";


interface AddToWishlistDto {
    userId: string;
    variantId: string;
}

export class WishlistService {
    private prisma: PrismaService = prisma;

    async toggleWishlistItem(
        data: AddToWishlistDto
    ): Promise<{ action: "added" | "removed"; item?: any }> {
        const { userId, variantId } = data;

        // check if item already exists
        const existingItem = await this.prisma.getClient().wishlist.findUnique({
            where: {
                userId_variantId: {
                    userId,
                    variantId,
                },
            },
        });

        if (existingItem) {
            await this.prisma.getClient().wishlist.delete({
                where: {
                    id: existingItem.id,
                },
            });
            logger.info("Item removed from wishlist", { userId, variantId });
            return { action: "removed" };
        }

        const wishlistItem = await this.prisma.getClient().wishlist.create({
            data: {
                userId,
                variantId,
            },
        });

        logger.info("Item added to wishlist", { id: wishlistItem.id, userId, variantId });
        return { action: "added", item: wishlistItem };
    }

    async getWishlistItems(userId: string) {
        const items = await this.prisma.getClient().wishlist.findMany({
            where: { userId },
            include: {
                variant: {
                    include: {
                        product: true,
                        images: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return items;
    }
}
