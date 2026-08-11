import { GenderType, PageType, SectionType } from "@prisma/client";
import { prisma } from "../../config/prisma.js";

/// Every placement owns exactly one collection, so the pair is always created,
/// renamed and deleted together. name/slug live on the collection; layout,
/// ordering and imagery live on the placement.

const ALL_GENDERS: GenderType[] = ["MEN", "WOMEN", "KIDS"];

/// A placement's page decides who its collection is for — a MEN grid section
/// can only ever hold menswear, while HOME and OFFERS span everyone.
const PAGE_GENDER: Record<PageType, GenderType[]> = {
    HOME: ALL_GENDERS,
    OFFERS: ALL_GENDERS,
    MEN: ["MEN"],
    WOMEN: ["WOMEN"],
    KIDS: ["KIDS"],
};

const slugify = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

export interface CreatePlacementInput {
    name: string;
    description?: string | undefined;
    page: PageType;
    section: SectionType;
    productId?: string | undefined;
    isBanner?: boolean | undefined;
    isActive?: boolean | undefined;
    image?: string | undefined;
    displayOrder?: number | undefined;
    /// Copy this placement's curated product list into the new one. The lists
    /// are independent afterwards — editing one never touches the other.
    sourcePlacementId?: string | undefined;
}

export interface UpdatePlacementInput {
    name?: string | undefined;
    description?: string | null | undefined;
    page?: PageType | undefined;
    section?: SectionType | undefined;
    productId?: string | null | undefined;
    isBanner?: boolean | undefined;
    isActive?: boolean | undefined;
    image?: string | undefined;
    displayOrder?: number | undefined;
}

export class AppPlacementService {
    private prisma = prisma;

    /// Product shape the storefront needs to render a placement card — the
    /// collage layout draws the first two product images next to the cover.
    private static readonly PRODUCT_PREVIEW_INCLUDE = {
        take: 2,
        orderBy: { displayOrder: "asc" as const },
        include: {
            product: {
                include: {
                    variants: {
                        take: 1,
                        orderBy: { isDefault: "desc" as const },
                        include: {
                            images: {
                                take: 1,
                                orderBy: { displayOrder: "asc" as const },
                            },
                        },
                    },
                },
            },
        },
    };

    private serialize(placement: any) {
        const previewImages: string[] = (placement.products ?? [])
            .map((pp: any) => pp.product?.variants?.[0]?.images?.[0]?.imageUrl)
            .filter(Boolean);

        return {
            id: placement.id,
            name: placement.collection?.name ?? null,
            slug: placement.collection?.slug ?? null,
            collectionId: placement.collectionId,
            description: placement.description,
            productId: placement.productId,
            imageUrl: placement.imageUrl,
            isBanner: placement.isBanner,
            page: placement.page,
            section: placement.section,
            displayOrder: placement.displayOrder,
            isActive: placement.isActive,
            gender: placement.collection?.gender ?? [],
            productCount: placement._count?.products ?? 0,
            previewImages,
            createdAt: placement.createdAt,
        };
    }

    /// Slugs are global, so "Best Sellers" on MEN and on WOMEN resolve to
    /// best-sellers and best-sellers-1 rather than colliding.
    private async uniqueSlug(tx: any, name: string, excludeCollectionId?: string): Promise<string> {
        const base = slugify(name) || "placement";
        let candidate = base;
        let counter = 1;

        while (
            await tx.collection.findFirst({
                where: {
                    slug: candidate,
                    ...(excludeCollectionId ? { id: { not: excludeCollectionId } } : {}),
                },
                select: { id: true },
            })
        ) {
            candidate = `${base}-${counter++}`;
        }

        return candidate;
    }

    /// New sections land at the bottom of their page. Ordering is page-wide,
    /// not per-section, because the app renders one interleaved column.
    private async nextDisplayOrder(tx: any, page: PageType): Promise<number> {
        const last = await tx.collectionPlacement.findFirst({
            where: { page },
            orderBy: { displayOrder: "desc" },
            select: { displayOrder: true },
        });
        return (last?.displayOrder ?? 0) + 1;
    }

    async getPlacements(query: {
        page?: PageType | undefined;
        section?: SectionType | undefined;
        isActive?: boolean | undefined;
    }) {
        const placements = await this.prisma.getClient().collectionPlacement.findMany({
            where: {
                ...(query.page ? { page: query.page } : {}),
                ...(query.section ? { section: query.section } : {}),
                ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
            },
            orderBy: [{ page: "asc" }, { displayOrder: "asc" }],
            include: {
                collection: true,
                _count: { select: { products: true } },
                products: AppPlacementService.PRODUCT_PREVIEW_INCLUDE,
            },
        });

        return {
            success: true,
            data: placements.map((p) => this.serialize(p)),
        };
    }

    async getPlacementById(id: string) {
        const placement = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id },
            include: {
                collection: true,
                products: {
                    include: { product: true },
                    orderBy: { displayOrder: "asc" },
                },
                _count: { select: { products: true } },
            },
        });

        if (!placement) {
            throw new Error("Placement not found");
        }

        return {
            success: true,
            data: {
                ...this.serialize(placement),
                collection: placement.collection,
                products: placement.products,
            },
        };
    }

    async createPlacement(data: CreatePlacementInput) {
        const name = data.name?.trim();
        if (!name) {
            throw new Error("Placement name is required");
        }

        const client = this.prisma.getClient();

        const placement = await client.$transaction(async (tx) => {
            const slug = await this.uniqueSlug(tx, name);

            const collection = await tx.collection.create({
                data: {
                    name,
                    slug,
                    gender: { set: PAGE_GENDER[data.page] ?? ALL_GENDERS },
                    isActive: data.isActive ?? true,
                },
            });

            const created = await tx.collectionPlacement.create({
                data: {
                    collectionId: collection.id,
                    description: data.description || null,
                    productId: data.productId || null,
                    page: data.page,
                    section: data.section,
                    isBanner: data.isBanner ?? false,
                    isActive: data.isActive ?? true,
                    imageUrl: data.image || null,
                    displayOrder: data.displayOrder ?? (await this.nextDisplayOrder(tx, data.page)),
                },
            });

            if (data.sourcePlacementId) {
                await this.copyProducts(tx, data.sourcePlacementId, created.id, collection.id);
            }

            return created;
        });

        return {
            success: true,
            data: (await this.getPlacementById(placement.id)).data,
            message: "Placement created successfully",
        };
    }

    /// Duplicating clones the source's look and its curated product list into a
    /// brand-new collection + placement. Nothing is shared with the original.
    async duplicatePlacement(
        sourceId: string,
        overrides: {
            name?: string | undefined;
            page?: PageType | undefined;
            section?: SectionType | undefined;
            isActive?: boolean | undefined;
        } = {}
    ) {
        const source = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id: sourceId },
            include: { collection: true },
        });

        if (!source) {
            throw new Error("Source placement not found");
        }

        return this.createPlacement({
            name: overrides.name?.trim() || `${source.collection.name} (Copy)`,
            description: source.description ?? undefined,
            page: overrides.page ?? source.page,
            section: overrides.section ?? source.section,
            productId: source.productId ?? undefined,
            isBanner: source.isBanner,
            isActive: overrides.isActive ?? source.isActive,
            image: source.imageUrl ?? undefined,
            sourcePlacementId: sourceId,
        });
    }

    private async copyProducts(
        tx: any,
        sourcePlacementId: string,
        targetPlacementId: string,
        targetCollectionId: string
    ) {
        const sourceProducts = await tx.collectionPlacementProduct.findMany({
            where: { placementId: sourcePlacementId },
            orderBy: { displayOrder: "asc" },
            select: { productId: true, displayOrder: true },
        });

        if (sourceProducts.length === 0) return;

        await tx.collectionPlacementProduct.createMany({
            data: sourceProducts.map((p: any) => ({
                placementId: targetPlacementId,
                productId: p.productId,
                displayOrder: p.displayOrder,
            })),
            skipDuplicates: true,
        });

        // Mirror onto the collection so slug-based lookups and coupon targeting
        // see the same products as the placement.
        await tx.productCollection.createMany({
            data: sourceProducts.map((p: any) => ({
                collectionId: targetCollectionId,
                productId: p.productId,
                displayOrder: p.displayOrder,
            })),
            skipDuplicates: true,
        });
    }

    async updatePlacement(id: string, data: UpdatePlacementInput) {
        const client = this.prisma.getClient();

        const existing = await client.collectionPlacement.findUnique({
            where: { id },
            include: { collection: true },
        });
        if (!existing) {
            throw new Error("Placement not found");
        }

        await client.$transaction(async (tx) => {
            const name = data.name?.trim();
            const collectionData: any = {};

            if (name && name !== existing.collection.name) {
                collectionData.name = name;
                collectionData.slug = await this.uniqueSlug(tx, name, existing.collectionId);
            }
            if (data.page !== undefined && data.page !== existing.page) {
                collectionData.gender = { set: PAGE_GENDER[data.page] ?? ALL_GENDERS };
            }
            if (data.isActive !== undefined) {
                collectionData.isActive = data.isActive;
            }

            if (Object.keys(collectionData).length > 0) {
                await tx.collection.update({
                    where: { id: existing.collectionId },
                    data: collectionData,
                });
            }

            const placementData: any = {};
            if (data.description !== undefined) placementData.description = data.description || null;
            if (data.productId !== undefined) placementData.productId = data.productId || null;
            if (data.page !== undefined) placementData.page = data.page;
            if (data.section !== undefined) placementData.section = data.section;
            if (data.isBanner !== undefined) placementData.isBanner = data.isBanner;
            if (data.isActive !== undefined) placementData.isActive = data.isActive;
            if (data.image !== undefined) placementData.imageUrl = data.image;
            if (data.displayOrder !== undefined) placementData.displayOrder = data.displayOrder;

            // Moving to another page sends the section to the bottom of it.
            if (data.page !== undefined && data.page !== existing.page && data.displayOrder === undefined) {
                placementData.displayOrder = await this.nextDisplayOrder(tx, data.page);
            }

            if (Object.keys(placementData).length > 0) {
                await tx.collectionPlacement.update({ where: { id }, data: placementData });
            }
        });

        return {
            success: true,
            data: (await this.getPlacementById(id)).data,
            message: "Placement updated successfully",
        };
    }

    /// Drag-to-reorder in the admin canvas sends the whole page's new order.
    async reorderPlacements(items: { id: string; displayOrder: number }[]) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error("A non-empty list of placements is required");
        }

        const client = this.prisma.getClient();

        await client.$transaction(
            items.map((item) =>
                client.collectionPlacement.update({
                    where: { id: item.id },
                    data: { displayOrder: item.displayOrder },
                })
            )
        );

        return { success: true, message: "Placements reordered successfully" };
    }

    /// Deleting the collection cascades to the placement, its curated product
    /// list and its coupon links — the pair never outlives one another.
    async deletePlacement(id: string) {
        const existing = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id },
            select: { collectionId: true },
        });
        if (!existing) {
            throw new Error("Placement not found");
        }

        await this.prisma.getClient().collection.delete({ where: { id: existing.collectionId } });

        return { success: true, message: "Placement deleted successfully" };
    }

    async addProductsToPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const placement = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id: placementId },
            select: { collectionId: true },
        });
        if (!placement) {
            throw new Error("Placement not found");
        }

        const client = this.prisma.getClient();

        await client.$transaction([
            client.collectionPlacementProduct.createMany({
                data: productIds.map((productId) => ({ placementId, productId })),
                skipDuplicates: true,
            }),
            client.productCollection.createMany({
                data: productIds.map((productId) => ({
                    collectionId: placement.collectionId,
                    productId,
                })),
                skipDuplicates: true,
            }),
        ]);

        return { success: true, message: "Products added to placement successfully" };
    }

    async removeProductsFromPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const placement = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id: placementId },
            select: { collectionId: true },
        });
        if (!placement) {
            throw new Error("Placement not found");
        }

        const client = this.prisma.getClient();

        await client.$transaction([
            client.collectionPlacementProduct.deleteMany({
                where: { placementId, productId: { in: productIds } },
            }),
            client.productCollection.deleteMany({
                where: { collectionId: placement.collectionId, productId: { in: productIds } },
            }),
        ]);

        return { success: true, message: "Products removed from placement successfully" };
    }
}
