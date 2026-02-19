import { PrismaService } from "../../core/services/index.js";

export class UserService {
    private prisma: PrismaService = new PrismaService();
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
