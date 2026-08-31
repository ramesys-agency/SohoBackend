import { describe, expect, it } from "vitest";
import {
    buildProductSearchWhere,
    buildSearchFacets,
    rankBySearchRelevance,
    scoreProduct,
    tokenize,
} from "../helpers/product-search.js";

describe("tokenize", () => {
    it("splits on punctuation and drops noise words", () => {
        expect(tokenize("Blue linen shirt for men")).toEqual(["blue", "linen", "shirt", "men"]);
    });

    it("keeps a single-character query, which is all the shopper typed", () => {
        expect(tokenize("M")).toEqual(["m"]);
    });

    it("de-duplicates repeated words", () => {
        expect(tokenize("shirt shirt")).toEqual(["shirt"]);
    });

    it("returns nothing for a query with no letters or digits", () => {
        expect(tokenize("   ---  ")).toEqual([]);
    });
});

describe("buildProductSearchWhere", () => {
    it("is undefined when there is nothing to search for", () => {
        expect(buildProductSearchWhere("")).toBeUndefined();
        expect(buildProductSearchWhere(undefined)).toBeUndefined();
    });

    it("requires every word to match somewhere on the product", () => {
        const where = buildProductSearchWhere("linen shirt") as any;

        expect(where.AND).toHaveLength(2);
        expect(where.AND[0].OR).toEqual(
            expect.arrayContaining([
                { name: { contains: "linen", mode: "insensitive" } },
                { category: { name: { contains: "linen", mode: "insensitive" } } },
            ])
        );
    });

    it("searches variants by SKU, colour and size", () => {
        const where = buildProductSearchWhere("navy") as any;
        const variantCondition = where.AND[0].OR.find((c: any) => c.variants);

        expect(variantCondition.variants.some.OR).toEqual([
            { sku: { contains: "navy", mode: "insensitive" } },
            { colorName: { contains: "navy", mode: "insensitive" } },
            { size: { equals: "navy", mode: "insensitive" } },
        ]);
    });

    it("strips a trailing plural so 'shirts' finds 'Shirt'", () => {
        const where = buildProductSearchWhere("shirts") as any;

        expect(where.AND[0].OR[0]).toEqual({ name: { contains: "shirt", mode: "insensitive" } });
    });

    it("maps everyday gender words onto the enum", () => {
        const where = buildProductSearchWhere("womens") as any;

        expect(where.AND[0].OR).toContainEqual({ gender: { has: "WOMEN" } });
    });

    it("widens to any word when matchAll is off", () => {
        const where = buildProductSearchWhere("linen shirt", { matchAll: false }) as any;

        expect(where.AND).toBeUndefined();
        expect(where.OR.length).toBeGreaterThan(4);
    });
});

describe("scoreProduct", () => {
    const product = (overrides: Record<string, unknown> = {}) => ({
        name: "Linen Shirt",
        description: null,
        overallRating: 0,
        reviewCount: 0,
        category: { name: "Shirts" },
        variants: [{ sku: "LIN-SHIRT-M", colorName: "Navy", size: "M" }],
        ...overrides,
    });

    it("puts an exact name match above a partial one", () => {
        expect(scoreProduct(product(), "linen shirt")).toBeGreaterThan(
            scoreProduct(product({ name: "Linen Shirt Oversized" }), "linen shirt")
        );
    });

    it("scores a word at the start of a word above one buried inside", () => {
        expect(scoreProduct(product({ name: "Shirt Dress" }), "shirt")).toBeGreaterThan(
            scoreProduct(product({ name: "Sweatshirt" }), "shirt")
        );
    });

    it("treats a full SKU as a near-certain hit", () => {
        expect(scoreProduct(product(), "LIN-SHIRT-M")).toBeGreaterThan(
            scoreProduct(product({ name: "Cotton Tee" }), "LIN-SHIRT-M")
        );
    });

    it("scores nothing when the query has no searchable words", () => {
        expect(scoreProduct(product(), "!!!")).toBe(0);
    });
});

describe("rankBySearchRelevance", () => {
    const make = (name: string, extras: Record<string, unknown> = {}) => ({
        name,
        overallRating: 0,
        reviewCount: 0,
        variants: [],
        ...extras,
    });

    it("orders the closest name match first", () => {
        const ranked = rankBySearchRelevance(
            [make("Silk Shirt Dress"), make("Sweatshirt"), make("Shirt")],
            "shirt"
        );

        expect(ranked.map((p) => p.name)).toEqual(["Shirt", "Silk Shirt Dress", "Sweatshirt"]);
    });

    it("breaks ties on review count", () => {
        const ranked = rankBySearchRelevance(
            [make("Shirt", { reviewCount: 2 }), make("Shirt", { reviewCount: 9 })],
            "shirt"
        );

        expect(ranked[0]!.reviewCount).toBe(9);
    });
});

describe("buildSearchFacets", () => {
    const products = [
        {
            gender: ["MEN"],
            category: { id: "c1", name: "Shirts", slug: "shirts" },
            variants: [
                { size: "M", colorName: "Navy", colorValue: "#000080", basePrice: 1200 },
                { size: "L", colorName: "Navy", colorValue: "#000080", basePrice: 1200 },
            ],
        },
        {
            gender: ["MEN", "WOMEN"],
            category: { id: "c1", name: "Shirts", slug: "shirts" },
            variants: [{ size: "S", colorName: "Red", colorValue: "#FF0000", basePrice: 800.5 }],
        },
    ];

    it("counts each product once per colour, not once per variant", () => {
        const { colors } = buildSearchFacets(products);

        expect(colors).toEqual([
            { colorName: "Navy", colorValue: "#000080", count: 1 },
            { colorName: "Red", colorValue: "#FF0000", count: 1 },
        ]);
    });

    it("orders sizes the way clothing sizes read", () => {
        expect(buildSearchFacets(products).sizes.map((s) => s.size)).toEqual(["S", "M", "L"]);
    });

    it("spans the price range of every matched variant", () => {
        expect(buildSearchFacets(products).priceRange).toEqual({ min: 800, max: 1200 });
    });

    it("counts categories and genders across the result set", () => {
        const facets = buildSearchFacets(products);

        expect(facets.categories).toEqual([
            { id: "c1", name: "Shirts", slug: "shirts", count: 2 },
        ]);
        expect(facets.genders).toEqual([
            { gender: "MEN", count: 2 },
            { gender: "WOMEN", count: 1 },
        ]);
    });

    it("has no price range when nothing matched", () => {
        expect(buildSearchFacets([]).priceRange).toBeNull();
    });
});
