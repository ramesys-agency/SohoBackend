/**
 * Free-text product search, shared by the storefront's search screen and the
 * admin product list so both find the same things.
 *
 * A query is split into tokens and every token has to match somewhere on the
 * product — its name, description, category, or one of its variants (SKU,
 * colour, size). That is what makes "blue linen shirt" work: no single column
 * contains that phrase, but each word is somewhere on the product. Matching is
 * substring-based, so "shirt" also finds "Oversized Shirt".
 */

import type { PrismaClient } from "@prisma/client";

type ProductWhere = NonNullable<
    NonNullable<Parameters<PrismaClient["product"]["findMany"]>[0]>["where"]
>;

/** Words shoppers type instead of the gender enum. */
const GENDER_WORDS: Record<string, "MEN" | "WOMEN" | "KIDS"> = {
    men: "MEN",
    mens: "MEN",
    man: "MEN",
    male: "MEN",
    gents: "MEN",
    women: "WOMEN",
    womens: "WOMEN",
    woman: "WOMEN",
    female: "WOMEN",
    ladies: "WOMEN",
    kid: "KIDS",
    kids: "KIDS",
    child: "KIDS",
    children: "KIDS",
    boy: "KIDS",
    boys: "KIDS",
    girl: "KIDS",
    girls: "KIDS",
};

/** Noise words that would otherwise force a match and empty the results. */
const STOP_WORDS = new Set(["the", "and", "for", "with", "a", "an", "of", "in", "to"]);

/** More tokens than this and the query is a sentence, not a search. */
const MAX_TOKENS = 8;

/**
 * How many matches are pulled in before ranking. Relevance ordering cannot be
 * expressed in SQL here, so a bounded pool is scored in memory; far beyond any
 * page a shopper will scroll to, and cheap for a catalogue of this size.
 */
export const SEARCH_CANDIDATE_LIMIT = 300;

/**
 * "shirts" and "shirt" should find each other. Substring matching already
 * covers the singular query, so only the trailing plural has to come off —
 * anything cleverer starts mangling words like "dress".
 */
const stem = (token: string): string =>
    token.length >= 4 && token.endsWith("s") && !token.endsWith("ss") ? token.slice(0, -1) : token;

export const tokenize = (query: string): string[] => {
    const words = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean);

    // Single-character words are dropped, unless that is all the shopper typed
    // (searching "M" for a size, say) — an empty token list matches everything.
    const meaningful = words.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    const kept = meaningful.length > 0 ? meaningful : words;

    return Array.from(new Set(kept)).slice(0, MAX_TOKENS);
};

/** Every place a single token is allowed to match. */
const tokenConditions = (token: string): ProductWhere[] => {
    const term = stem(token);
    const conditions: ProductWhere[] = [
        { name: { contains: term, mode: "insensitive" } },
        { description: { contains: term, mode: "insensitive" } },
        { category: { name: { contains: term, mode: "insensitive" } } },
        {
            variants: {
                some: {
                    OR: [
                        { sku: { contains: term, mode: "insensitive" } },
                        { colorName: { contains: term, mode: "insensitive" } },
                        { size: { equals: token, mode: "insensitive" } },
                    ],
                },
            },
        },
    ];

    const gender = GENDER_WORDS[token];
    if (gender) {
        conditions.push({ gender: { has: gender } });
    }

    return conditions;
};

/**
 * The `where` fragment for a query string, or undefined when there is nothing
 * to search for. `matchAll` narrows with every extra word; the caller can flip
 * it to widen a search that came back empty.
 */
export const buildProductSearchWhere = (
    query: string | undefined,
    { matchAll = true }: { matchAll?: boolean } = {}
): ProductWhere | undefined => {
    const tokens = tokenize(query ?? "");
    if (tokens.length === 0) return undefined;

    if (!matchAll) {
        return { OR: tokens.flatMap(tokenConditions) };
    }

    return { AND: tokens.map((token) => ({ OR: tokenConditions(token) })) };
};

export interface RankableProduct {
    name: string;
    description?: string | null;
    overallRating?: { toString(): string } | number | null;
    reviewCount?: number | null;
    category?: { name?: string | null } | null;
    variants?: {
        sku?: string | null;
        colorName?: string | null;
        size?: string | null;
    }[];
}

const contains = (haystack: string | null | undefined, needle: string): boolean =>
    Boolean(haystack && haystack.toLowerCase().includes(needle));

/** True when the term starts a word, so "shirt" scores higher on "Shirt Dress" than on "Sweatshirt". */
const startsWord = (haystack: string | null | undefined, needle: string): boolean => {
    if (!haystack) return false;
    const text = haystack.toLowerCase();
    let from = text.indexOf(needle);
    while (from !== -1) {
        if (from === 0 || !/[a-z0-9]/.test(text[from - 1]!)) return true;
        from = text.indexOf(needle, from + 1);
    }
    return false;
};

/**
 * Relevance for one product against one query. The exact weights matter less
 * than their order: a name match beats a category match beats a description
 * match, and the whole phrase beats its individual words.
 */
export const scoreProduct = (product: RankableProduct, query: string): number => {
    const phrase = query.trim().toLowerCase();
    const tokens = tokenize(query);
    if (tokens.length === 0) return 0;

    const name = product.name?.toLowerCase() ?? "";
    let score = 0;

    if (name === phrase) score += 1000;
    else if (name.startsWith(phrase)) score += 400;
    else if (name.includes(phrase)) score += 200;

    for (const token of tokens) {
        const term = stem(token);

        if (startsWord(name, term)) score += 60;
        else if (contains(name, term)) score += 35;

        if (contains(product.category?.name, term)) score += 25;

        const variants = product.variants ?? [];
        if (variants.some((v) => v.sku?.toLowerCase() === token)) score += 150;
        else if (variants.some((v) => contains(v.sku, term))) score += 30;

        if (variants.some((v) => contains(v.colorName, term))) score += 20;
        if (variants.some((v) => v.size?.toLowerCase() === token)) score += 10;

        if (contains(product.description, term)) score += 8;
    }

    // Ratings only break ties between products that matched equally well.
    const rating = Number(product.overallRating ?? 0);
    score += Number.isFinite(rating) ? rating * 2 : 0;

    return score;
};

export interface SearchFacets {
    categories: { id: string; name: string; slug: string; count: number }[];
    colors: { colorName: string; colorValue: string; count: number }[];
    sizes: { size: string; count: number }[];
    genders: { gender: string; count: number }[];
    priceRange: { min: number; max: number } | null;
}

export interface FacetableProduct {
    gender?: string[] | null;
    category?: { id: string; name: string; slug: string } | null;
    variants?: {
        size?: string | null;
        colorName?: string | null;
        colorValue?: string | null;
        basePrice?: { toString(): string } | number | string | null;
    }[];
}

/** Clothing sizes read wrong in any order but this one. */
const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "XXXL"];

/**
 * What the current result set is made of: the categories, colours, sizes and
 * price span the shopper can narrow to. Built from the matches themselves, so
 * every option offered leads to at least one product.
 */
export const buildSearchFacets = (products: FacetableProduct[]): SearchFacets => {
    const categories = new Map<string, { id: string; name: string; slug: string; count: number }>();
    const colors = new Map<string, { colorName: string; colorValue: string; count: number }>();
    const sizes = new Map<string, number>();
    const genders = new Map<string, number>();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const product of products) {
        if (product.category) {
            const entry = categories.get(product.category.id) ?? { ...product.category, count: 0 };
            entry.count += 1;
            categories.set(product.category.id, entry);
        }

        for (const gender of product.gender ?? []) {
            genders.set(gender, (genders.get(gender) ?? 0) + 1);
        }

        // Colours and sizes are counted once per product, not once per variant,
        // so the count matches the number of results the filter would leave.
        const productColors = new Set<string>();
        const productSizes = new Set<string>();

        for (const variant of product.variants ?? []) {
            if (variant.colorName && variant.colorValue) {
                const key = `${variant.colorName.toLowerCase()}|${variant.colorValue.toLowerCase()}`;
                if (!productColors.has(key)) {
                    productColors.add(key);
                    const entry = colors.get(key) ?? {
                        colorName: variant.colorName,
                        colorValue: variant.colorValue,
                        count: 0,
                    };
                    entry.count += 1;
                    colors.set(key, entry);
                }
            }

            if (variant.size) {
                const size = variant.size.toUpperCase();
                if (!productSizes.has(size)) {
                    productSizes.add(size);
                    sizes.set(size, (sizes.get(size) ?? 0) + 1);
                }
            }

            const price = Number(variant.basePrice ?? NaN);
            if (Number.isFinite(price)) {
                min = Math.min(min, price);
                max = Math.max(max, price);
            }
        }
    }

    const sizeRank = (size: string) => {
        const index = SIZE_ORDER.indexOf(size);
        return index === -1 ? SIZE_ORDER.length : index;
    };

    return {
        categories: [...categories.values()].sort((a, b) => b.count - a.count),
        colors: [...colors.values()].sort((a, b) => b.count - a.count),
        sizes: [...sizes.entries()]
            .map(([size, count]) => ({ size, count }))
            .sort((a, b) => sizeRank(a.size) - sizeRank(b.size) || a.size.localeCompare(b.size)),
        genders: [...genders.entries()]
            .map(([gender, count]) => ({ gender, count }))
            .sort((a, b) => b.count - a.count),
        priceRange:
            min === Number.POSITIVE_INFINITY
                ? null
                : { min: Math.floor(min), max: Math.ceil(max) },
    };
};

/** Highest relevance first, then the better-reviewed product. */
export const rankBySearchRelevance = <T extends RankableProduct>(products: T[], query: string): T[] =>
    products
        .map((product, index) => ({ product, index, score: scoreProduct(product, query) }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const reviews = (b.product.reviewCount ?? 0) - (a.product.reviewCount ?? 0);
            if (reviews !== 0) return reviews;
            return a.index - b.index; // keep the caller's order for true ties
        })
        .map((entry) => entry.product);
