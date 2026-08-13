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
    /// Derive the product list from this category instead of hand-picking it.
    sourceCategoryId?: string | undefined;
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
    sourceCategoryId?: string | null | undefined;
}

/// Where a product in a resolved list came from — the admin shows this so a
/// merchandiser can tell why something is on the page, and what removing it
/// will actually do.
export type ProductOrigin = "auto" | "added";

interface PlacementSource {
    id: string;
    page: PageType;
    sourceCategoryId: string | null;
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

    /// Category-sourced placements have no stored list, so their count and
    /// preview images are resolved first and handed in here.
    private serialize(placement: any, resolved?: { productCount: number; previewImages: string[] }) {
        const previewImages: string[] =
            resolved?.previewImages ??
            (placement.products ?? [])
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
            sourceCategoryId: placement.sourceCategoryId ?? null,
            page: placement.page,
            section: placement.section,
            displayOrder: placement.displayOrder,
            isActive: placement.isActive,
            gender: placement.collection?.gender ?? [],
            productCount: resolved?.productCount ?? placement._count?.products ?? 0,
            previewImages,
            createdAt: placement.createdAt,
        };
    }

    // ------------------------------------------------------------------
    // Product resolution
    //
    // A hand-picked placement's rows *are* its product list. A
    // category-sourced placement's list is computed fresh every read:
    //
    //     (products in the category tree + INCLUDE rows) - EXCLUDE rows
    //
    // so products added to the category later show up on their own, and a
    // product that leaves the category disappears unless someone had pinned
    // it with an explicit INCLUDE. Rows carrying a displayOrder position the
    // products they name; everything else follows in newest-first order.
    // ------------------------------------------------------------------

    /// One pass over the category table, reused for every placement in the
    /// request — resolving a catalog page one placement at a time would scan
    /// the whole table once per circle.
    private async descendantsOf(rootIds: string[]): Promise<Map<string, string[]>> {
        const map = new Map<string, string[]>();
        if (rootIds.length === 0) return map;

        // Categories are soft-deleted, so a deleted one has to drop out here or
        // its circle would keep serving products after the merchandiser
        // removed it. Deleting a parent takes its whole subtree with it.
        const categories = await this.prisma
            .getClient()
            .category.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true } });

        const alive = new Set(categories.map((category) => category.id));

        const childrenOf = new Map<string, string[]>();
        for (const category of categories) {
            if (!category.parentId) continue;
            const siblings = childrenOf.get(category.parentId) ?? [];
            siblings.push(category.id);
            childrenOf.set(category.parentId, siblings);
        }

        for (const rootId of rootIds) {
            if (!alive.has(rootId)) {
                map.set(rootId, []);
                continue;
            }

            const collected: string[] = [rootId];
            const queue: string[] = [rootId];

            while (queue.length > 0) {
                const current = queue.shift() as string;
                for (const child of childrenOf.get(current) ?? []) {
                    collected.push(child);
                    queue.push(child);
                }
            }

            map.set(rootId, collected);
        }

        return map;
    }

    /// Resolves several placements at once: one category query, one product
    /// query and one override query serve the whole page.
    private async resolveMany(placements: PlacementSource[]): Promise<Map<string, string[]>> {
        const resolved = new Map<string, string[]>();
        if (placements.length === 0) return resolved;

        const client = this.prisma.getClient();

        const overrideRows = await client.collectionPlacementProduct.findMany({
            where: { placementId: { in: placements.map((p) => p.id) } },
            orderBy: { displayOrder: "asc" },
            select: { placementId: true, productId: true, mode: true },
        });

        const categoryRoots = placements
            .map((p) => p.sourceCategoryId)
            .filter((id): id is string => Boolean(id));
        const descendantMap = await this.descendantsOf([...new Set(categoryRoots)]);

        // Every category any of these placements draws from, in one query.
        const allCategoryIds = [...new Set([...descendantMap.values()].flat())];
        const autoProducts =
            allCategoryIds.length === 0
                ? []
                : await client.product.findMany({
                      where: {
                          categoryId: { in: allCategoryIds },
                          isPublished: true,
                          deletedAt: null,
                      },
                      orderBy: { createdAt: "desc" },
                      select: { id: true, categoryId: true, gender: true },
                  });

        for (const placement of placements) {
            const rows = overrideRows.filter((r) => r.placementId === placement.id);

            if (!placement.sourceCategoryId) {
                resolved.set(
                    placement.id,
                    rows.filter((r) => r.mode !== "EXCLUDE").map((r) => r.productId)
                );
                continue;
            }

            const categoryIds = new Set(descendantMap.get(placement.sourceCategoryId) ?? []);
            // A circle on the Men tab shows menswear only, even when the
            // category itself spans genders.
            const pageGenders = PAGE_GENDER[placement.page] ?? ALL_GENDERS;
            const autoIds = autoProducts
                .filter(
                    (product) =>
                        categoryIds.has(product.categoryId) &&
                        product.gender.some((g) => pageGenders.includes(g))
                )
                .map((product) => product.id);

            const excluded = new Set(
                rows.filter((r) => r.mode === "EXCLUDE").map((r) => r.productId)
            );
            const included = rows.filter((r) => r.mode === "INCLUDE").map((r) => r.productId);

            const visible = new Set(
                [...autoIds, ...included].filter((id) => !excluded.has(id))
            );

            // Rows arrive in displayOrder, so they set the front of the list;
            // untouched auto products keep their default order behind them.
            const ordered: string[] = [];
            const seen = new Set<string>();

            for (const row of rows) {
                if (row.mode === "EXCLUDE") continue;
                if (!visible.has(row.productId) || seen.has(row.productId)) continue;
                ordered.push(row.productId);
                seen.add(row.productId);
            }
            for (const id of autoIds) {
                if (!visible.has(id) || seen.has(id)) continue;
                ordered.push(id);
                seen.add(id);
            }

            resolved.set(placement.id, ordered);
        }

        return resolved;
    }

    /// The single-placement entry point used by the storefront product query.
    async resolveProductIds(placementId: string): Promise<string[]> {
        const placement = await this.prisma.getClient().collectionPlacement.findUnique({
            where: { id: placementId },
            select: { id: true, page: true, sourceCategoryId: true },
        });
        if (!placement) return [];

        const resolved = await this.resolveMany([placement]);
        return resolved.get(placementId) ?? [];
    }

    /// First two primary images for a set of products, keyed by product id.
    private async primaryImages(productIds: string[]): Promise<Map<string, string>> {
        const images = new Map<string, string>();
        if (productIds.length === 0) return images;

        const products = await this.prisma.getClient().product.findMany({
            where: { id: { in: productIds } },
            select: {
                id: true,
                variants: {
                    take: 1,
                    orderBy: { isDefault: "desc" },
                    select: { images: { take: 1, orderBy: { displayOrder: "asc" } } },
                },
            },
        });

        for (const product of products) {
            const url = product.variants[0]?.images[0]?.imageUrl;
            if (url) images.set(product.id, url);
        }

        return images;
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

        // Category-sourced placements store overrides rather than a list, so
        // their count and preview images have to be resolved rather than read.
        const resolved = await this.resolveMany(
            placements.filter((p) => p.sourceCategoryId) as unknown as PlacementSource[]
        );
        const images = await this.primaryImages(
            [...resolved.values()].flatMap((ids) => ids.slice(0, 2))
        );

        return {
            success: true,
            data: placements.map((placement) => {
                const ids = resolved.get(placement.id);
                if (!ids) return this.serialize(placement);

                return this.serialize(placement, {
                    productCount: ids.length,
                    previewImages: ids
                        .slice(0, 2)
                        .map((id) => images.get(id))
                        .filter((url): url is string => Boolean(url)),
                });
            }),
        };
    }

    async getPlacementById(id: string) {
        const client = this.prisma.getClient();

        const placement = await client.collectionPlacement.findUnique({
            where: { id },
            include: {
                collection: true,
                products: { orderBy: { displayOrder: "asc" } },
                _count: { select: { products: true } },
            },
        });

        if (!placement) {
            throw new Error("Placement not found");
        }

        // The admin edits the resolved list, not the stored rows, so this
        // returns what the storefront would actually render — each entry
        // flagged with where it came from.
        const productIds = await this.resolveProductIds(id);
        const products =
            productIds.length === 0
                ? []
                : await client.product.findMany({ where: { id: { in: productIds } } });
        const byId = new Map(products.map((product) => [product.id, product]));
        const pinned = new Set(
            placement.products.filter((row) => row.mode === "INCLUDE").map((row) => row.productId)
        );

        const resolvedProducts = productIds.map((productId, index) => ({
            placementId: id,
            productId,
            displayOrder: index,
            // On a hand-picked placement every product was chosen by hand.
            origin: (!placement.sourceCategoryId || pinned.has(productId)
                ? "added"
                : "auto") as ProductOrigin,
            product: byId.get(productId) ?? null,
        }));

        const images = await this.primaryImages(productIds.slice(0, 2));

        return {
            success: true,
            data: {
                ...this.serialize(placement, {
                    productCount: productIds.length,
                    previewImages: productIds
                        .slice(0, 2)
                        .map((productId) => images.get(productId))
                        .filter((url): url is string => Boolean(url)),
                }),
                collection: placement.collection,
                products: resolvedProducts,
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
                    sourceCategoryId: data.sourceCategoryId || null,
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

            // Repointing at another category (or dropping the link entirely)
            // invalidates every override, since they describe products relative
            // to the old one.
            if (
                data.sourceCategoryId !== undefined &&
                (data.sourceCategoryId || null) !== existing.sourceCategoryId
            ) {
                placementData.sourceCategoryId = data.sourceCategoryId || null;
                await tx.collectionPlacementProduct.deleteMany({ where: { placementId: id } });
            }

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

    /// Loads a placement and, for category-sourced ones, works out which of the
    /// given products the category already supplies. Adding or removing one of
    /// those means writing an override; the rest are plain rows.
    private async placementWithMembership(placementId: string, productIds: string[]) {
        const client = this.prisma.getClient();

        const placement = await client.collectionPlacement.findUnique({
            where: { id: placementId },
            select: { id: true, collectionId: true, page: true, sourceCategoryId: true },
        });
        if (!placement) {
            throw new Error("Placement not found");
        }

        if (!placement.sourceCategoryId) {
            return { placement, fromCategory: new Set<string>() };
        }

        const descendants = await this.descendantsOf([placement.sourceCategoryId]);
        const categoryIds = new Set(descendants.get(placement.sourceCategoryId) ?? []);

        const products = await client.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true, categoryId: true },
        });

        return {
            placement,
            fromCategory: new Set(
                products.filter((p) => categoryIds.has(p.categoryId)).map((p) => p.id)
            ),
        };
    }

    async addProductsToPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const client = this.prisma.getClient();
        const { placement, fromCategory } = await this.placementWithMembership(
            placementId,
            productIds
        );

        if (!placement.sourceCategoryId) {
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

        // Re-adding something the category already provides just clears the
        // exclusion; anything else gets pinned so it survives recategorising.
        // The collection is deliberately not mirrored here — a derived list
        // copied into ProductCollection would be stale the moment the category
        // changed.
        await client.$transaction(async (tx) => {
            const restore = productIds.filter((id) => fromCategory.has(id));
            const pin = productIds.filter((id) => !fromCategory.has(id));

            if (restore.length > 0) {
                await tx.collectionPlacementProduct.deleteMany({
                    where: { placementId, productId: { in: restore }, mode: "EXCLUDE" },
                });
            }

            for (const productId of pin) {
                await tx.collectionPlacementProduct.upsert({
                    where: { placementId_productId: { placementId, productId } },
                    create: { placementId, productId, mode: "INCLUDE" },
                    update: { mode: "INCLUDE" },
                });
            }
        });

        return { success: true, message: "Products added to placement successfully" };
    }

    async removeProductsFromPlacement(placementId: string, productIds: string[]) {
        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("Product IDs are required and must be an array");
        }

        const client = this.prisma.getClient();
        const { placement, fromCategory } = await this.placementWithMembership(
            placementId,
            productIds
        );

        if (!placement.sourceCategoryId) {
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

        // Something the category supplies can only be hidden, not deleted —
        // the category would just hand it back on the next read.
        await client.$transaction(async (tx) => {
            const hide = productIds.filter((id) => fromCategory.has(id));
            const drop = productIds.filter((id) => !fromCategory.has(id));

            if (drop.length > 0) {
                await tx.collectionPlacementProduct.deleteMany({
                    where: { placementId, productId: { in: drop } },
                });
            }

            for (const productId of hide) {
                await tx.collectionPlacementProduct.upsert({
                    where: { placementId_productId: { placementId, productId } },
                    create: { placementId, productId, mode: "EXCLUDE" },
                    update: { mode: "EXCLUDE" },
                });
            }
        });

        return { success: true, message: "Products removed from placement successfully" };
    }

    /// Drag-to-order inside a placement. Takes the full visible list in its new
    /// order; products the category supplies get a position-only row so they
    /// still disappear if they ever leave the category.
    async reorderPlacementProducts(placementId: string, productIds: string[]) {
        if (!Array.isArray(productIds) || productIds.length === 0) {
            throw new Error("A non-empty list of product IDs is required");
        }

        const client = this.prisma.getClient();

        const placement = await client.collectionPlacement.findUnique({
            where: { id: placementId },
            select: { sourceCategoryId: true },
        });
        if (!placement) {
            throw new Error("Placement not found");
        }

        const existing = await client.collectionPlacementProduct.findMany({
            where: { placementId },
            select: { productId: true, mode: true },
        });
        const pinned = new Set(
            existing.filter((row) => row.mode === "INCLUDE").map((row) => row.productId)
        );

        await client.$transaction(async (tx) => {
            for (const [index, productId] of productIds.entries()) {
                const mode =
                    !placement.sourceCategoryId || pinned.has(productId) ? "INCLUDE" : "ORDER";

                await tx.collectionPlacementProduct.upsert({
                    where: { placementId_productId: { placementId, productId } },
                    create: { placementId, productId, displayOrder: index, mode },
                    update: { displayOrder: index, mode },
                });
            }
        });

        return { success: true, message: "Placement products reordered successfully" };
    }

    /// Throws away every override so the list goes back to being exactly what
    /// the category holds. Only meaningful for category-sourced placements.
    async resetPlacementProducts(placementId: string) {
        const client = this.prisma.getClient();

        const placement = await client.collectionPlacement.findUnique({
            where: { id: placementId },
            select: { sourceCategoryId: true },
        });
        if (!placement) {
            throw new Error("Placement not found");
        }
        if (!placement.sourceCategoryId) {
            throw new Error("This placement has no source category to reset to");
        }

        await client.collectionPlacementProduct.deleteMany({ where: { placementId } });

        return { success: true, message: "Placement products reset to the category list" };
    }
}
