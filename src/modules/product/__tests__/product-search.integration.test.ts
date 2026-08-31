import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../config/prisma.js";
import { ProductService } from "../product.service.js";

/**
 * The search query built in `product-search.ts` is only half the story — the
 * other half is whether Postgres agrees. These run the real thing against the
 * test database: what a shopper types has to reach the right rows, and drafts
 * and deleted products have to stay out of the storefront's results.
 */

const db = () => prisma.getClient();

let products: ProductService;
let shirtId: string;
let jacketId: string;
let draftId: string;
let deletedId: string;

beforeAll(async () => {
    products = new ProductService();
    await reset();

    const shirts = await db().category.create({
        data: { name: "Shirts", slug: unique("shirts") },
    });
    const outerwear = await db().category.create({
        data: { name: "Outerwear", slug: unique("outerwear") },
    });

    shirtId = await createProduct({
        name: "Linen Shirt",
        description: "A breathable summer shirt",
        categoryId: shirts.id,
        gender: ["MEN"],
        variants: [
            { sku: "LIN-NAVY-M", size: "M", colorName: "Navy", colorValue: "#000080", price: 1500 },
            { sku: "LIN-NAVY-L", size: "L", colorName: "Navy", colorValue: "#000080", price: 1500 },
        ],
    });

    jacketId = await createProduct({
        name: "Denim Jacket",
        description: "Rugged everyday layer",
        categoryId: outerwear.id,
        gender: ["WOMEN"],
        variants: [
            { sku: "DEN-BLUE-S", size: "S", colorName: "Blue", colorValue: "#0000FF", price: 4200 },
        ],
    });

    draftId = await createProduct({
        name: "Linen Shirt Unreleased",
        categoryId: shirts.id,
        isPublished: false,
        variants: [
            { sku: "LIN-DRAFT-M", size: "M", colorName: "Navy", colorValue: "#000080", price: 1900 },
        ],
    });

    deletedId = await createProduct({
        name: "Linen Shirt Discontinued",
        categoryId: shirts.id,
        deletedAt: new Date(),
        variants: [
            { sku: "LIN-OLD-M", size: "M", colorName: "Navy", colorValue: "#000080", price: 900 },
        ],
    });
});

afterAll(async () => {
    await reset();
});

describe("storefront search", () => {
    it("finds a product by a word from its name", async () => {
        const result = await products.searchProducts({ q: "linen" });

        expect(result.products.map((p) => p.id)).toEqual([shirtId]);
        expect(result.pagination.total).toBe(1);
    });

    it("requires every word to match, then widens rather than showing nothing", async () => {
        const both = await products.searchProducts({ q: "linen jacket" });

        // Nothing is both, so the search widens to either — and says so.
        expect(both.widened).toBe(true);
        expect(both.products.map((p) => p.id).sort()).toEqual([jacketId, shirtId].sort());
    });

    it("finds a product by its SKU", async () => {
        const result = await products.searchProducts({ q: "LIN-NAVY-M" });

        expect(result.products.map((p) => p.id)).toEqual([shirtId]);
    });

    it("finds a product by colour and by category name", async () => {
        await expect(
            products.searchProducts({ q: "navy" }).then((r) => r.products.map((p) => p.id))
        ).resolves.toEqual([shirtId]);

        await expect(
            products.searchProducts({ q: "outerwear" }).then((r) => r.products.map((p) => p.id))
        ).resolves.toEqual([jacketId]);
    });

    it("matches a plural query against a singular name", async () => {
        const result = await products.searchProducts({ q: "shirts" });

        expect(result.products.map((p) => p.id)).toEqual([shirtId]);
    });

    it("reads everyday gender words", async () => {
        const result = await products.searchProducts({ q: "womens" });

        expect(result.products.map((p) => p.id)).toEqual([jacketId]);
    });

    it("keeps drafts and deleted products out of the storefront", async () => {
        const result = await products.searchProducts({ q: "linen shirt" });
        const ids = result.products.map((p) => p.id);

        expect(ids).toContain(shirtId);
        expect(ids).not.toContain(draftId);
        expect(ids).not.toContain(deletedId);
    });

    it("filters by size, colour and price on the same variant", async () => {
        await expect(
            products.searchProducts({ q: "shirt", size: "M" }).then((r) => r.count)
        ).resolves.toBe(1);

        await expect(
            products.searchProducts({ q: "shirt", size: "XL" }).then((r) => r.count)
        ).resolves.toBe(0);

        await expect(
            products.searchProducts({ q: "shirt", color: "navy" }).then((r) => r.count)
        ).resolves.toBe(1);

        await expect(
            products.searchProducts({ q: "shirt", maxPrice: 1000 }).then((r) => r.count)
        ).resolves.toBe(0);
    });

    it("searches on filters alone, with no query typed", async () => {
        const result = await products.searchProducts({ gender: "MEN" });

        expect(result.products.map((p) => p.id)).toEqual([shirtId]);
    });

    it("offers facets covering the whole match, not just the applied filter", async () => {
        const result = await products.searchProducts({ q: "shirt", color: "navy" });

        // Narrowing to navy must not remove every other colour from the sheet.
        expect(result.facets.sizes.map((s) => s.size)).toEqual(["M", "L"]);
        expect(result.facets.categories[0]?.name).toBe("Shirts");
        expect(result.facets.priceRange).toEqual({ min: 1500, max: 1500 });
    });

    it("sorts by price when asked", async () => {
        const cheapest = await products.searchProducts({ q: "linen jacket", sortBy: "price_asc" });
        const dearest = await products.searchProducts({ q: "linen jacket", sortBy: "price_desc" });

        expect(cheapest.products[0]?.id).toBe(shirtId);
        expect(dearest.products[0]?.id).toBe(jacketId);
    });

    it("answers an empty search with the catalogue's facets and no products", async () => {
        // The filter sheet opens before anything is typed, and needs the sizes
        // and colours the catalogue actually stocks.
        const result = await products.searchProducts({ q: "   " });

        expect(result.products).toEqual([]);
        expect(result.pagination.total).toBe(0);
        expect(result.facets.sizes.map((s) => s.size)).toEqual(["S", "M", "L"]);
        expect(result.facets.colors.map((c) => c.colorName).sort()).toEqual(["Blue", "Navy"]);
        // Drafts are not part of the catalogue the shopper can filter.
        expect(result.facets.categories.map((c) => c.count)).toEqual([1, 1]);
    });
});

describe("admin product list", () => {
    it("searches drafts too when asked for every status", async () => {
        const result = await products.getAllProducts({ search: "linen", isPublished: "all" });

        const ids = result.products.map((p) => p.id);
        expect(ids).toContain(shirtId);
        expect(ids).toContain(draftId);
        // Soft-deleted stays hidden even for the admin list.
        expect(ids).not.toContain(deletedId);
    });

    it("finds a product by SKU from the admin list", async () => {
        const result = await products.getAllProducts({ search: "DEN-BLUE-S", isPublished: "all" });

        expect(result.products.map((p) => p.id)).toEqual([jacketId]);
    });

    it("ranks the closest match first when searching", async () => {
        const result = await products.getAllProducts({ search: "linen shirt", isPublished: "all" });

        expect(result.products[0]?.id).toBe(shirtId);
    });

    it("sorts the list by the cheapest variant", async () => {
        const asc = await products.getAllProducts({ sortBy: "price_asc", isPublished: "all" });
        const desc = await products.getAllProducts({ sortBy: "price_desc", isPublished: "all" });

        expect(asc.products[0]?.id).toBe(shirtId);
        expect(desc.products[0]?.id).toBe(jacketId);
        expect(asc.pagination.total).toBe(3); // both live products plus the draft
    });
});

// --- Fixtures ---------------------------------------------------------------

const unique = (prefix: string) =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function createProduct(data: {
    name: string;
    categoryId: string;
    description?: string;
    gender?: ("MEN" | "WOMEN" | "KIDS")[];
    isPublished?: boolean;
    deletedAt?: Date;
    variants: {
        sku: string;
        size: string;
        colorName: string;
        colorValue: string;
        price: number;
    }[];
}): Promise<string> {
    const product = await db().product.create({
        data: {
            name: data.name,
            description: data.description ?? null,
            categoryId: data.categoryId,
            attributes: {},
            gender: data.gender ?? [],
            isPublished: data.isPublished ?? true,
            deletedAt: data.deletedAt ?? null,
            variants: {
                create: data.variants.map((variant, index) => ({
                    sku: variant.sku,
                    size: variant.size,
                    colorName: variant.colorName,
                    colorValue: variant.colorValue,
                    stockQty: 5,
                    basePrice: variant.price,
                    isDefault: index === 0,
                    images: {
                        create: {
                            imageUrl: `https://example.test/${variant.sku}.jpg`,
                            isPrimary: true,
                            displayOrder: 1,
                        },
                    },
                })),
            },
        },
    });

    return product.id;
}

async function reset(): Promise<void> {
    const client = db();
    await client.productVariantImage.deleteMany({});
    await client.productPriceHistory.deleteMany({});
    await client.productVariant.deleteMany({});
    await client.productCollection.deleteMany({});
    await client.product.deleteMany({});
    await client.category.deleteMany({});
}
