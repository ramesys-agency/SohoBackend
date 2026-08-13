import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { scrypt, randomBytes } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
    return `${salt}:${derivedKey.toString("hex")}`;
}

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PRODUCT_COUNT = 120;

const genders = ["Men", "Women", "Kids"];
const genderEnumMap: Record<string, any> = {
    Men: "MEN",
    Women: "WOMEN",
    Kids: "KIDS",
};

const fabrics = ["Cotton", "Poly Cotton", "Denim", "Linen", "Silk", "Wool"];
const occasions = ["Casual", "Formal", "Festive", "Sports", "Party"];

const SIZES = ["S", "M", "L", "XL", "XXL"];

const colors = [
    { name: "Black", hex: "000000" },
    { name: "White", hex: "FFFFFF" },
    { name: "Navy Blue", hex: "000080" },
    { name: "Crimson Red", hex: "DC143C" },
    { name: "Olive Green", hex: "556B2F" },
    { name: "Royal Blue", hex: "4169E1" },
    { name: "Charcoal Gray", hex: "36454F" },
    { name: "Maroon", hex: "800000" },
    { name: "Teal", hex: "008080" },
    { name: "Mustard Yellow", hex: "E1AD01" },
];

function randomFrom<T>(arr: T[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice(base = 799) {
    return base + Math.floor(Math.random() * 1500);
}

function getPlaceholderUrl(
    width: number,
    height: number,
    bgColor: string,
    textColor: string,
    text: string
) {
    const cleanText = encodeURIComponent(text);
    return `https://placehold.co/${width}x${height}/${bgColor}/${textColor}.png?text=${cleanText}`;
}

async function main() {
    console.log("🌱 Starting robust seed...");

    console.log("👤 Creating User & Admin...");
    const passwordHash = await hashPassword("Password@123");

    await prisma.user.upsert({
        where: { email: "admin@soho.com" },
        update: {},
        create: {
            email: "admin@soho.com",
            fullName: "Admin Soho",
            passwordHash,
            role: "admin",
            isVerified: true,
        },
    });

    await prisma.user.upsert({
        where: { email: "user@soho.com" },
        update: {},
        create: {
            email: "user@soho.com",
            fullName: "User Soho",
            passwordHash,
            role: "customer",
            isVerified: true,
        },
    });

    // ------------------------
    // CATEGORIES
    // ------------------------
    console.log("📂 Seeding Categories...");
    const categoryDefs = [
        { name: "T-Shirts", slug: "t-shirts" },
        { name: "Shirts", slug: "shirts" },
        { name: "Jeans", slug: "jeans" },
        { name: "Dresses", slug: "dresses" },
        { name: "Jackets", slug: "jackets" },
        { name: "Accessories", slug: "accessories" },
    ];

    const categories = [];
    for (const def of categoryDefs) {
        const cat = await prisma.category.upsert({
            where: { slug: def.slug },
            update: {},
            create: {
                name: def.name,
                slug: def.slug,
                imageUrl: getPlaceholderUrl(400, 400, "E2E8F0", "475569", def.name),
            },
        });

        // Seed Gender Specific Images
        const genderStyles: Record<string, { bg: string; text: string }> = {
            MEN: { bg: "1E293B", text: "FFFFFF" },
            WOMEN: { bg: "BE185D", text: "FFFFFF" },
            KIDS: { bg: "15803D", text: "FFFFFF" },
        };

        for (const gender of ["MEN", "WOMEN", "KIDS"]) {
            await prisma.categoryImage.upsert({
                where: {
                    categoryId_gender: {
                        categoryId: cat.id,
                        gender: gender as any,
                    },
                },
                update: {
                    imageUrl: getPlaceholderUrl(
                        400,
                        400,
                        genderStyles[gender].bg,
                        genderStyles[gender].text,
                        `${def.name} - ${gender}`
                    ),
                },
                create: {
                    categoryId: cat.id,
                    gender: gender as any,
                    imageUrl: getPlaceholderUrl(
                        400,
                        400,
                        genderStyles[gender].bg,
                        genderStyles[gender].text,
                        `${def.name} - ${gender}`
                    ),
                },
            });
        }
        categories.push(cat);
    }

    // ------------------------
    // PLACEMENTS (each owns its own collection, 1:1)
    // Every page+section slot is its own editable entity: own name, slug,
    // image and product list. "Best Sellers" on MEN and on WOMEN are two
    // separate rows that an admin can rename or re-curate independently.
    // ------------------------
    console.log("🖼️ Seeding Placements & their Collections...");

    const placementSeeds = [
        // ---------- HOME ----------
        {
            slug: "summer-sale-2024",
            page: "HOME",
            section: "HERO",
            name: "Summer Sale 2024",
            description: "Up to 50% off across the summer range.",
            theme: "summer-sale",
            order: 1,
            isBanner: true,
        },
        {
            slug: "women-fashionable-top",
            page: "HOME",
            section: "FEATURED_ROW",
            name: "Women Fashionable Top",
            description:
                "This dress embodies sustainable fashion practices, woven from eco-friendly materials and produced with ethical craftsmanship.",
            theme: "premium-collection",
            order: 2,
            isBanner: false,
        },
        {
            slug: "fashionable-dress",
            page: "HOME",
            section: "GRID_SECTION",
            name: "Fashionable Dress",
            description:
                "Festive-ready silhouettes cut from breathable fabric, finished by hand.",
            theme: "festive-deals",
            order: 3,
            isBanner: false,
        },
        {
            slug: "luxurious-gown",
            page: "HOME",
            section: "MID_BANNER",
            name: "Luxurious Gown",
            description:
                "Statement pieces for the evening, made in small runs from premium cloth.",
            theme: "premium-collection",
            order: 4,
            isBanner: false,
        },
        {
            slug: "fashionable-heels",
            page: "HOME",
            section: "SEE_ALL",
            name: "Fashionable Heels",
            description: "Fresh drops landing every week — see what just arrived.",
            theme: "new-arrivals",
            order: 5,
            isBanner: false,
        },
        {
            // The home screen renders this one as its own product grid rather
            // than a promo card, matched by name. The slug is what the admin's
            // own uniqueSlug() produces for "Best Sellers", so seeding adopts a
            // hand-created row instead of making a second one beside it.
            slug: "best-sellers",
            page: "HOME",
            section: "GRID_SECTION",
            name: "Best Sellers",
            description: "What everyone is buying right now.",
            theme: "best-sellers",
            order: 6,
            isBanner: false,
        },
        {
            slug: "trending-now-home",
            page: "HOME",
            section: "GRID_SECTION",
            name: "Trending Now",
            description: "Picking up speed this week.",
            theme: "trending-now",
            order: 7,
            isBanner: false,
        },

        // ---------- MEN ----------
        { slug: "mens-premium", page: "MEN", section: "HERO", name: "Men's Premium", description: "The considered end of the menswear range.", theme: "premium-collection", order: 1, isBanner: true },
        { slug: "office-basics-men", page: "MEN", section: "FEATURED_ROW", name: "Office Basics for Men", description: "Formal staples that survive the whole week.", theme: "office-basics", order: 2, isBanner: false },
        { slug: "new-arrivals-men", page: "MEN", section: "GRID_SECTION", name: "New Arrivals — Men", description: null, theme: "new-arrivals", order: 3, isBanner: false },
        { slug: "best-sellers-men", page: "MEN", section: "GRID_SECTION", name: "Best Sellers — Men", description: null, theme: "best-sellers", order: 4, isBanner: false },
        { slug: "trending-men", page: "MEN", section: "GRID_SECTION", name: "Trending — Men", description: null, theme: "trending-now", order: 5, isBanner: false },
        { slug: "budget-buys-men", page: "MEN", section: "GRID_SECTION", name: "Budget Buys — Men", description: null, theme: "budget-buys", order: 6, isBanner: false },
        { slug: "everyday-essentials-men", page: "MEN", section: "GRID_SECTION", name: "Everyday Essentials — Men", description: null, theme: "everyday-essentials", order: 7, isBanner: false },
        { slug: "limited-edition-men", page: "MEN", section: "GRID_SECTION", name: "Limited Edition — Men", description: null, theme: "limited-edition", order: 8, isBanner: false },

        // ---------- WOMEN ----------
        { slug: "womens-latest-trends", page: "WOMEN", section: "HERO", name: "Women's Latest Trends", description: "This season, as it is actually being worn.", theme: "trending-now", order: 1, isBanner: true },
        { slug: "premium-selection-women", page: "WOMEN", section: "FEATURED_ROW", name: "Premium Selection — Women", description: "Elevated pieces worth the shelf space.", theme: "premium-collection", order: 2, isBanner: false },
        { slug: "new-arrivals-women", page: "WOMEN", section: "GRID_SECTION", name: "New Arrivals — Women", description: null, theme: "new-arrivals", order: 3, isBanner: false },
        { slug: "best-sellers-women", page: "WOMEN", section: "GRID_SECTION", name: "Best Sellers — Women", description: null, theme: "best-sellers", order: 4, isBanner: false },
        { slug: "summer-sale-women", page: "WOMEN", section: "GRID_SECTION", name: "Summer Sale — Women", description: null, theme: "summer-sale", order: 5, isBanner: false },
        { slug: "everyday-essentials-women", page: "WOMEN", section: "GRID_SECTION", name: "Everyday Essentials — Women", description: null, theme: "everyday-essentials", order: 6, isBanner: false },
        { slug: "limited-edition-women", page: "WOMEN", section: "GRID_SECTION", name: "Limited Edition — Women", description: null, theme: "limited-edition", order: 7, isBanner: false },

        // ---------- KIDS ----------
        { slug: "kids-playroom", page: "KIDS", section: "HERO", name: "Kids Playroom Favourites", description: "Built for the playground, washed a hundred times.", theme: "best-sellers", order: 1, isBanner: true },
        { slug: "new-arrivals-kids", page: "KIDS", section: "GRID_SECTION", name: "New Arrivals — Kids", description: null, theme: "new-arrivals", order: 2, isBanner: false },
        { slug: "best-sellers-kids", page: "KIDS", section: "GRID_SECTION", name: "Best Sellers — Kids", description: null, theme: "best-sellers", order: 3, isBanner: false },
        { slug: "festive-kids", page: "KIDS", section: "GRID_SECTION", name: "Festive — Kids", description: null, theme: "festive-deals", order: 4, isBanner: false },
        { slug: "budget-buys-kids", page: "KIDS", section: "GRID_SECTION", name: "Budget Buys — Kids", description: null, theme: "budget-buys", order: 5, isBanner: false },
        { slug: "everyday-essentials-kids", page: "KIDS", section: "GRID_SECTION", name: "Everyday Essentials — Kids", description: null, theme: "everyday-essentials", order: 6, isBanner: false },

        // ---------- OFFERS ----------
        { slug: "festive-mega-deals", page: "OFFERS", section: "GRID_SECTION", name: "Festive Mega Deals", description: "The festive drop, priced to move.", theme: "festive-deals", order: 1, isBanner: true },
        { slug: "budget-buys-offers", page: "OFFERS", section: "GRID_SECTION", name: "Budget Buys", description: "Everything under ৳1,000.", theme: "budget-buys", order: 2, isBanner: false },
        { slug: "limited-edition-offers", page: "OFFERS", section: "GRID_SECTION", name: "Limited Edition Drops", description: "Small runs, gone when they are gone.", theme: "limited-edition", order: 3, isBanner: false },
        { slug: "summer-sale-offers", page: "OFFERS", section: "GRID_SECTION", name: "Summer Sale", description: "End-of-season markdowns.", theme: "summer-sale", order: 4, isBanner: false },
    ] as const;

    const PAGE_GENDERS: Record<string, string[]> = {
        HOME: ["MEN", "WOMEN", "KIDS"],
        OFFERS: ["MEN", "WOMEN", "KIDS"],
        MEN: ["MEN"],
        WOMEN: ["WOMEN"],
        KIDS: ["KIDS"],
    };

    // Landscape for full-width banners, portrait for the collage/side layouts.
    const SECTION_IMAGE_SIZE: Record<string, [number, number]> = {
        HERO: [1200, 400],
        SEE_ALL: [1200, 400],
        FEATURED_ROW: [600, 800],
        GRID_SECTION: [600, 800],
        MID_BANNER: [600, 800],
    };

    const placementMap: Record<string, { placementId: string; collectionId: string }> = {};

    for (const seed of placementSeeds) {
        const [width, height] = SECTION_IMAGE_SIZE[seed.section] ?? [600, 800];
        const imageUrl = getPlaceholderUrl(
            width,
            height,
            "333333",
            "FFFFFF",
            seed.name.toUpperCase()
        );

        const collection = await prisma.collection.upsert({
            where: { slug: seed.slug },
            update: {
                name: seed.name,
                gender: { set: PAGE_GENDERS[seed.page] as any },
            },
            create: {
                name: seed.name,
                slug: seed.slug,
                gender: { set: PAGE_GENDERS[seed.page] as any },
            },
        });

        const existingPlacement = await prisma.collectionPlacement.findUnique({
            where: { collectionId: collection.id },
        });

        const placement = existingPlacement
            ? await prisma.collectionPlacement.update({
                  where: { id: existingPlacement.id },
                  data: {
                      page: seed.page as any,
                      section: seed.section as any,
                      description: seed.description,
                      imageUrl,
                      displayOrder: seed.order,
                      isBanner: seed.isBanner,
                  },
              })
            : await prisma.collectionPlacement.create({
                  data: {
                      collectionId: collection.id,
                      page: seed.page as any,
                      section: seed.section as any,
                      description: seed.description,
                      imageUrl,
                      displayOrder: seed.order,
                      isBanner: seed.isBanner,
                  },
              });

        placementMap[seed.slug] = { placementId: placement.id, collectionId: collection.id };
    }

    // ------------------------
    // PRODUCT GENERATION
    // ------------------------
    console.log("👕 Seeding Products & Variants...");

    // Products are tagged with themes here, then handed to whichever placements
    // asked for that theme — so one theme can fill several independent sections.
    const seededProducts: { id: string; gender: string; themes: string[] }[] = [];

    for (let i = 1; i <= PRODUCT_COUNT; i++) {
        const category = randomFrom(categories);
        const genderLabel = randomFrom(genders);
        const genEnum = genderEnumMap[genderLabel];

        const basePrice = randomPrice();
        const productName = `${genderLabel}'s ${category.name} ${i}`;

        // Find or create product
        let product = await prisma.product.findFirst({
            where: { name: productName },
        });

        if (!product) {
            product = await prisma.product.create({
                data: {
                    name: productName,
                    description: `Experience ultimate comfort and style with this ${productName.toLowerCase()}. Made with premium ${randomFrom(fabrics).toLowerCase()} fabric, perfect for any ${randomFrom(occasions).toLowerCase()} occasion.`,
                    categoryId: category.id,
                    isPublished: true,
                    gender: { set: [genEnum] },
                    attributes: {
                        gender: genderLabel,
                        fabric: randomFrom(fabrics),
                        occasion: randomFrom(occasions),
                    },
                },
            });
        }

        // Theme tags drive which placements this product shows up in. Computed
        // every run so re-seeding an existing database still fills the sections.
        const occasion = (product.attributes as any)?.occasion;
        const themes = ["new-arrivals"];
        if (Math.random() < 0.3) themes.push("best-sellers");
        if (Math.random() < 0.2) themes.push("trending-now");
        if (Math.random() < 0.25) themes.push("summer-sale");
        if (Math.random() < 0.15) themes.push("limited-edition");
        if (basePrice < 1000) themes.push("budget-buys");
        if (basePrice > 1800) themes.push("premium-collection");
        if (occasion === "Festive") themes.push("festive-deals");
        if (occasion === "Formal") themes.push("office-basics");
        if (occasion === "Casual") themes.push("everyday-essentials");

        seededProducts.push({ id: product.id, gender: genEnum, themes });


        // ------------------------
        // VARIANTS
        // ------------------------
        const numVariants = Math.floor(Math.random() * 3) + 2; // 2 to 4 variants
        const usedSkus = new Set<string>();

        for (let j = 0; j < numVariants; j++) {
            const color = randomFrom(colors);
            const size = randomFrom(SIZES);
            const sku = `${category.slug}-${color.name.toLowerCase().replace(/\s+/g, "-")}-${size.toLowerCase()}-${i}`;

            if (usedSkus.has(sku)) continue;
            usedSkus.add(sku);

            const variant = await prisma.productVariant.upsert({
                where: { sku },
                update: {
                    basePrice,
                    originalPrice: basePrice + 500,
                    stockQty: Math.floor(Math.random() * 100) + 10,
                },
                create: {
                    productId: product.id,
                    sku,
                    size,
                    colorName: color.name,
                    colorValue: `#${color.hex}`,
                    stockQty: Math.floor(Math.random() * 100) + 10,
                    basePrice,
                    originalPrice: basePrice + 500,
                    isDefault: usedSkus.size === 1,
                },
            });

            // ------------------------
            // IMAGES for Variant (Clear and re-create to ensure extensions are updated)
            // ------------------------
            await prisma.productVariantImage.deleteMany({
                where: { variantId: variant.id },
            });

            const views = ["Front View", "Back View", "Side View", "Detail"];
            for (let vIdx = 0; vIdx < views.length; vIdx++) {
                const view = views[vIdx];
                const textColor = color.name === "White" ? "000000" : "FFFFFF";

                await prisma.productVariantImage.create({
                    data: {
                        variantId: variant.id,
                        imageUrl: getPlaceholderUrl(
                            600,
                            800,
                            color.hex,
                            textColor,
                            `${color.name} ${category.name} - ${view}`
                        ),
                        isPrimary: vIdx === 0,
                        displayOrder: vIdx,
                    },
                });
            }
        }
    }

    // ------------------------
    // PLACEMENT PRODUCTS
    // Each placement gets its own curated list: the theme it asked for,
    // narrowed to the genders its page serves. The same list is mirrored onto
    // the placement's collection so coupons and slug lookups agree with it.
    // ------------------------
    console.log("🔗 Seeding placement product lists...");

    const MAX_PRODUCTS_PER_PLACEMENT = 24;

    for (const seed of placementSeeds) {
        const target = placementMap[seed.slug];
        if (!target) continue;

        const allowedGenders = PAGE_GENDERS[seed.page] ?? [];
        const picked = seededProducts
            .filter((p) => p.themes.includes(seed.theme))
            .filter((p) => allowedGenders.includes(p.gender))
            .slice(0, MAX_PRODUCTS_PER_PLACEMENT);

        // Idempotent: rebuild both sides from scratch each run.
        await prisma.collectionPlacementProduct.deleteMany({
            where: { placementId: target.placementId },
        });
        await prisma.productCollection.deleteMany({
            where: { collectionId: target.collectionId },
        });

        if (picked.length === 0) {
            console.warn(`   ⚠️  ${seed.name} (${seed.page}/${seed.section}) matched no products`);
            continue;
        }

        await prisma.collectionPlacementProduct.createMany({
            data: picked.map((p, idx) => ({
                placementId: target.placementId,
                productId: p.id,
                displayOrder: idx,
            })),
            skipDuplicates: true,
        });

        await prisma.productCollection.createMany({
            data: picked.map((p, idx) => ({
                collectionId: target.collectionId,
                productId: p.id,
                displayOrder: idx,
            })),
            skipDuplicates: true,
        });
    }

    // ------------------------
    // CATEGORY CIRCLES
    // The round shortcuts along the top of each catalog tab. Unlike every
    // placement above, these carry no product rows: their list is derived from
    // the category at read time, so a product added to "Shirts" later shows up
    // in the Shirts circle on its own. Rows only ever appear here when an admin
    // pins, hides or reorders something.
    // ------------------------
    console.log("⭕ Seeding category circles...");

    const CIRCLE_STYLE: Record<string, { bg: string; text: string }> = {
        MEN: { bg: "1E293B", text: "FFFFFF" },
        WOMEN: { bg: "BE185D", text: "FFFFFF" },
        KIDS: { bg: "15803D", text: "FFFFFF" },
    };

    let circleCount = 0;

    for (const gender of ["MEN", "WOMEN", "KIDS"] as const) {
        for (const [index, category] of categories.entries()) {
            const slug = `${category.slug}-${gender.toLowerCase()}-circle`;

            const collection = await prisma.collection.upsert({
                where: { slug },
                update: { name: category.name, gender: { set: [gender] } },
                create: {
                    name: category.name,
                    slug,
                    gender: { set: [gender] },
                },
            });

            const imageUrl = getPlaceholderUrl(
                400,
                400,
                CIRCLE_STYLE[gender].bg,
                CIRCLE_STYLE[gender].text,
                `${category.name} - ${gender}`
            );

            const existing = await prisma.collectionPlacement.findUnique({
                where: { collectionId: collection.id },
            });

            if (existing) {
                await prisma.collectionPlacement.update({
                    where: { id: existing.id },
                    data: {
                        page: gender,
                        section: "CATEGORY_CIRCLE",
                        sourceCategoryId: category.id,
                        imageUrl,
                        displayOrder: index + 1,
                        isActive: true,
                        isBanner: false,
                    },
                });
            } else {
                await prisma.collectionPlacement.create({
                    data: {
                        collectionId: collection.id,
                        page: gender,
                        section: "CATEGORY_CIRCLE",
                        sourceCategoryId: category.id,
                        imageUrl,
                        displayOrder: index + 1,
                        isActive: true,
                        isBanner: false,
                    },
                });
            }

            circleCount++;
        }
    }

    console.log(
        `✅ Seed completed! ${PRODUCT_COUNT} products across ${placementSeeds.length} placements, plus ${circleCount} category circles.`
    );
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
