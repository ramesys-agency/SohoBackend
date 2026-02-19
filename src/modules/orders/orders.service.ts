import { PrismaService } from "../../core/services/index.js";
import { NotFoundError, ForbiddenError } from "../../core/errors/http-errors.js";

export class OrderService {
    private prisma: PrismaService = new PrismaService();

    async getAllOrders(userId: string) {
        return await this.prisma.getClient().order.findMany({
            where: { userId },
            include: {
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                    },
                },
                address: true,
            },
            orderBy: { createdAt: "desc" },
        });
    }

    async getOrderById(userId: string, orderId: string) {
        const order = await this.prisma.getClient().order.findUnique({
            where: { id: orderId },
            include: {
                items: {
                    include: {
                        product: true,
                        variant: {
                            include: {
                                images: true,
                            },
                        },
                    },
                },
                address: true,
                payments: true,
                statusLogs: {
                    orderBy: { createdAt: "desc" },
                },
            },
        });

        if (!order) {
            throw new NotFoundError("Order not found");
        }

        if (order.userId !== userId) {
            throw new ForbiddenError("You are not authorized to view this order");
        }

        return order;
    }
}
