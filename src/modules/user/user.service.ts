import { PrismaService } from "../../core/services/index.js";
import { prisma } from "../../config/prisma.js";


export class UserService {
    private prisma: PrismaService = prisma;
    async updateProfile(
        userId: string,
        data: {
            fullName?: string | undefined;
            phone?: string | undefined;
            gender?: string | undefined;
            age?: number | undefined;
            region?: string | undefined;
        }
    ) {
        return await this.prisma.getClient().user.update({
            where: { id: userId },
            data: Object.fromEntries(
                Object.entries(data).filter(([_, v]) => v !== undefined)
            ) as any,
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                gender: true,
                age: true,
                region: true,
                role: true,
                avatar: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async updateAvatar(userId: string, avatarUrl: string) {
        return await this.prisma.getClient().user.update({
            where: { id: userId },
            data: { avatar: avatarUrl },
            select: {
                id: true,
                avatar: true,
            },
        });
    }

    async getProfile(userId: string) {
        return await this.prisma.getClient().user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                gender: true,
                age: true,
                region: true,
                role: true,
                avatar: true,
                createdAt: true,
                updatedAt: true,
            },
        });
    }

    async getAllUsers(params: { page?: number; limit?: number; search?: string } = {}) {
        const page = params.page ?? 1;
        const limit = params.limit ?? 20;
        const skip = (page - 1) * limit;

        const where = {
            isDeleted: false,
            ...(params.search
                ? {
                      OR: [
                          { fullName: { contains: params.search, mode: "insensitive" as const } },
                          { email: { contains: params.search, mode: "insensitive" as const } },
                      ],
                  }
                : {}),
        };

        const [users, total] = await Promise.all([
            this.prisma.getClient().user.findMany({
                where,
                skip,
                take: limit,
                orderBy: { createdAt: "desc" },
                select: {
                    id: true,
                    email: true,
                    fullName: true,
                    phone: true,
                    gender: true,
                    age: true,
                    region: true,
                    role: true,
                    avatar: true,
                    isVerified: true,
                    createdAt: true,
                },
            }),
            this.prisma.getClient().user.count({ where }),
        ]);

        return {
            data: users,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        };
    }

    async deleteAccount(userId: string) {
        return await this.prisma.getClient().user.update({
            where: { id: userId },
            data: {
                isDeleted: true,
                deletedAt: new Date(),
            },
        });
    }
}
