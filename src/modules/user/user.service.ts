import { PrismaService } from "../../core/services/index.js";
import { prisma } from "../../config/prisma.js";
// import { AuthUtils } from "../auth/auth.utils.js";
import { ConflictError, NotFoundError } from "../../core/errors/index.js";
import { authService } from "../../config/auth.js";

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

    async getAllUsers(
        params: {
            page?: number;
            limit?: number;
            search?: string;
            region?: string;
            role?: string;
            showDeleted?: string;
        } = {}
    ) {
        const page = params.page ?? 1;
        const limit = params.limit ?? 20;
        const skip = (page - 1) * limit;

        const where: any = {};

        if (params.showDeleted === "all") {
            // Display both active and deleted users
        } else if (params.showDeleted === "only") {
            where.isDeleted = true;
        } else {
            where.isDeleted = false;
        }

        if (params.role) {
            if (params.role === "customer" || params.role === "admin") {
                where.role = params.role;
            }
            // If "all", we don't apply a role filter.
        } else {
            // Default to customers only
            where.role = "customer";
        }

        if (params.region && params.region !== "All Regions") {
            where.region = { equals: params.region, mode: "insensitive" as const };
        }

        if (params.search) {
            where.OR = [
                { fullName: { contains: params.search, mode: "insensitive" as const } },
                { email: { contains: params.search, mode: "insensitive" as const } },
            ];
        }

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
                    isDeleted: true,
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

    /**
     * Deletes the user's account and personal data.
     *
     * Apple's App Store guideline 5.1.1(v) requires that deleting an account
     * actually deletes it, not just hides it. A user with no orders is removed
     * from the database outright.
     *
     * A user with orders keeps a stub row: `Order.userId` is a required foreign
     * key, so removing the row would take the order history — a financial record
     * — with it. Every identifying field on the user row is scrubbed and the
     * email is freed for re-registration.
     *
     * Note what this deliberately does NOT erase: the delivery `Address` rows an
     * order points at, and the `customerFullName` / `customerEmail` /
     * `customerMobileNumber` / `dropAddress` snapshots on the order itself. They
     * are retained as business records, and a COD parcel already with the courier
     * still has to reach the customer. The privacy policy must disclose this
     * retention.
     */
    async deleteAccount(userId: string) {
        const db = this.prisma.getClient();

        const user = await db.user.findUnique({
            where: { id: userId },
            select: { id: true, role: true, isDeleted: true },
        });

        if (!user || user.isDeleted) {
            throw new NotFoundError("User not found");
        }

        await db.$transaction(async (tx) => {
            // Personal data with no business or legal reason to survive.
            await tx.cartItem.deleteMany({ where: { userId } });
            await tx.wishlist.deleteMany({ where: { userId } });
            await tx.pushToken.deleteMany({ where: { userId } });
            await tx.notification.deleteMany({ where: { userId } });
            await tx.savedPaymentMethod.deleteMany({ where: { userId } });
            await tx.review.deleteMany({ where: { userId } });

            // Addresses that no order points at can go; the rest are part of the
            // order record and are removed together with the user's last order.
            await tx.address.deleteMany({
                where: { userId, orders: { none: {} } },
            });

            const orderCount = await tx.order.count({ where: { userId } });

            if (orderCount === 0) {
                await tx.address.deleteMany({ where: { userId } });
                await tx.user.delete({ where: { id: userId } });
                return;
            }

            await tx.user.update({
                where: { id: userId },
                data: {
                    // Unique + non-routable, so the real address can be reused
                    // for a new signup and nothing can be mailed to this row.
                    email: `deleted-${userId}@deleted.invalid`,
                    fullName: "Deleted user",
                    phone: null,
                    passwordHash: null,
                    authProviderId: null,
                    avatar: null,
                    age: null,
                    gender: null,
                    region: null,
                    isVerified: false,
                    isDeleted: true,
                    deletedAt: new Date(),
                },
            });
        });

        // Sessions are cached; drop the entry so existing tokens stop resolving.
        await authService.invalidateUserCache(userId, user.role);

        return { deleted: true };
    }

    async createAdmin(data: {
        email: string;
        passwordHash: string;
        fullName: string;
        phone?: string;
        region?: string;
    }) {
        const existingUser = await this.prisma.getClient().user.findUnique({
            where: { email: data.email },
        });

        if (existingUser) {
            throw new ConflictError("User with this email already exists");
        }

        return await this.prisma.getClient().user.create({
            data: {
                ...data,
                role: "admin",
                isVerified: true,
            },
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                region: true,
                role: true,
                avatar: true,
                createdAt: true,
            },
        });
    }
}
