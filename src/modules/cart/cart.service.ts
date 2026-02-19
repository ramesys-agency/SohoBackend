import { PrismaService } from "../../core/services/prisma.service.js";

export class CartService {
    private prisma: PrismaService = new PrismaService();

    async addItem(userId: string, variantId: string) {
        // Check if item already exists
        const existingItem = await this.prisma.getClient().cartItem.findFirst({
            where: {
                userId,
                variantId,
            },
        });

        if (existingItem) {
            return await this.prisma.getClient().cartItem.update({
                where: {
                    id: existingItem.id,
                },
                data: {
                    quantity: existingItem.quantity + 1,
                },
            });
        }

        return await this.prisma.getClient().cartItem.create({
            data: {
                userId,
                variantId,
                quantity: 1,
            },
        });
    }

    async deleteItem(userId: string, variantId: string) {
        const existingItem = await this.prisma.getClient().cartItem.findFirst({
            where: {
                userId,
                variantId,
            },
        });

        if (!existingItem) {
            // Item not found, could return null or throw.
            // Returning null implies nothing to delete.
            return null;
        }

        return await this.prisma.getClient().cartItem.delete({
            where: {
                id: existingItem.id,
            },
        });
    }

    async getAllItems(userId: string) {
        return await this.prisma.getClient().cartItem.findMany({
            where: {
                userId,
            },
            include: {
                variant: {
                    include: {
                        product: true,
                    },
                },
            },
        });
    }
}
