import { PrismaService } from "../../core/services/prisma.service.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";


export class StatsService {
    private prisma = prisma;

    async getDashboardStats() {
        try {
            const prismaClient = this.prisma.getClient();

            // 1. Total Sales
            const salesAggregate = await prismaClient.order.aggregate({
                _sum: {
                    totalAmount: true,
                },
            });
            const totalSales = Number(salesAggregate._sum.totalAmount || 0);

            // 2. Total Orders
            const totalOrders = await prismaClient.order.count();

            // 3. Total Customers
            const totalCustomers = await prismaClient.user.count({
                where: {
                    role: "customer",
                },
            });

            // 4. Recent Orders
            const recentOrdersRaw = await prismaClient.order.findMany({
                take: 5,
                orderBy: {
                    createdAt: "desc",
                },
                include: {
                    user: {
                        select: {
                            fullName: true,
                        },
                    },
                },
            });

            const recentOrders = (recentOrdersRaw as any[]).map((order) => ({
                id: order.id,
                customer: order.user?.fullName || "Unknown",
                amount: Number(order.totalAmount),
                status: order.status,
                date: order.createdAt.toISOString(),
            }));

            // 5. Sales Trend (Last 6 months)
            const now = new Date();
            const sixMonthsAgo = new Date();
            sixMonthsAgo.setMonth(now.getMonth() - 5);
            sixMonthsAgo.setDate(1);
            sixMonthsAgo.setHours(0, 0, 0, 0);

            const monthlySales = await prismaClient.order.findMany({
                where: {
                    createdAt: {
                        gte: sixMonthsAgo,
                    },
                },
                select: {
                    totalAmount: true,
                    createdAt: true,
                },
            });

            const months = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec",
            ];
            const trendMap = new Map<string, number>();

            // Initialize last 6 months
            for (let i = 0; i < 6; i++) {
                const d = new Date();
                d.setMonth(now.getMonth() - i);
                const monthName = months[d.getMonth()] || "";
                trendMap.set(monthName, 0);
            }

            monthlySales.forEach((order) => {
                const monthName = months[new Date(order.createdAt).getMonth()] || "";
                if (trendMap.has(monthName)) {
                    trendMap.set(
                        monthName,
                        (trendMap.get(monthName) || 0) + Number(order.totalAmount)
                    );
                }
            });

            const salesTrend = Array.from(trendMap.entries())
                .map(([month, amount]) => ({ month, amount }))
                .reverse();

            return {
                totalSales,
                totalOrders,
                totalCustomers,
                recentOrders,
                salesTrend,
            };
        } catch (error) {
            logger.error("Error fetching dashboard stats:", error as any);
            throw error;
        }
    }
}
