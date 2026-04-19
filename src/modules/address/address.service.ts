import { PrismaService } from "../../core/services/index.js";
import type { CreateAddressInput, UpdateAddressInput } from "./address.type.js";

export class AddressService {
    private prisma: PrismaService = new PrismaService();

    async getAddresses(userId: string) {
        return await this.prisma.getClient().address.findMany({
            where: { userId, isDeleted: false },
            orderBy: [{ isDefault: "desc" }, { id: "asc" }],
        });
    }

    async getAddressById(addressId: string, userId: string) {
        return await this.prisma.getClient().address.findFirst({
            where: { id: addressId, userId, isDeleted: false },
        });
    }

    async createAddress(userId: string, data: CreateAddressInput) {
        // If isDefault is true, unset the previous default
        if (data.isDefault) {
            await this.prisma.getClient().address.updateMany({
                where: { userId, isDefault: true },
                data: { isDefault: false },
            });
        }

        return await this.prisma.getClient().address.create({
            data: {
                user: { connect: { id: userId } },
                type: data.type,
                street: data.street,
                city: data.city ?? null,
                state: data.state ?? null,
                division: (data as any).division ?? null,
                district: (data as any).district ?? null,
                thana: (data as any).thana ?? null,
                area: (data as any).area ?? null,
                postalCode: data.postalCode,
                country: data.country ?? null,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
                placeId: data.placeId ?? null,
                formattedAddress: data.formattedAddress ?? null,
                isDefault: data.isDefault,
            },
        });
    }

    async updateAddress(addressId: string, userId: string, data: UpdateAddressInput) {
        // Verify ownership
        const existing = await this.prisma.getClient().address.findFirst({
            where: { id: addressId, userId },
        });

        if (!existing) {
            return null;
        }

        // If setting as default, unset the previous default
        if (data.isDefault) {
            await this.prisma.getClient().address.updateMany({
                where: { userId, isDefault: true, NOT: { id: addressId } },
                data: { isDefault: false },
            });
        }

        return await this.prisma.getClient().address.update({
            where: { id: addressId },
            data: Object.fromEntries(
                Object.entries(data).filter(([_, v]) => v !== undefined)
            ) as any,
        });
    }

    async setDefault(addressId: string, userId: string) {
        // Verify ownership
        const existing = await this.prisma.getClient().address.findFirst({
            where: { id: addressId, userId },
        });

        if (!existing) {
            return null;
        }

        // Use a transaction: unset all defaults, then set the target
        const [, updated] = await this.prisma.getClient().$transaction([
            this.prisma.getClient().address.updateMany({
                where: { userId, isDefault: true },
                data: { isDefault: false },
            }),
            this.prisma.getClient().address.update({
                where: { id: addressId },
                data: { isDefault: true },
            }),
        ]);

        return updated;
    }

    async deleteAddress(addressId: string, userId: string) {
        // Verify ownership
        const existing = await this.prisma.getClient().address.findFirst({
            where: { id: addressId, userId, isDeleted: false },
        });

        if (!existing) {
            return null;
        }

        return await this.prisma.getClient().address.update({
            where: { id: addressId },
            data: { 
                isDeleted: true,
                deletedAt: new Date()
            },
        });
    }
}
