import { PrismaService } from "../../core/services/index.js";
import { GenderType } from "../../generated/prisma/index.js";

export class CategoryService {
    private prisma = new PrismaService();

    async getAllCategories(query: { isActive?: string; parentId?: string; gender?: GenderType }) {
        const where: any = {};

        if (query.gender) {
            where.gender = {
                has: query.gender,
            };
        }

        if (query.isActive !== undefined) {
            where.isActive = query.isActive === "true";
        }

        if (query.parentId !== undefined) {
            if (query.parentId === "null") {
                where.parentId = null;
            } else {
                where.parentId = query.parentId;
            }
        }

        const categories = await this.prisma.getClient().category.findMany({
            where,
            include: {
                children: true,
            },
            orderBy: {
                displayOrder: "asc",
            },
        });

        return {
            success: true,
            data: categories,
        };
    }
}
