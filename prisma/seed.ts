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
        { name: "T-Shirts", slug: "t-shirts", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Shirts", slug: "shirts", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Jeans", slug: "jeans", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Dresses", slug: "dresses", gender: ["WOMEN", "KIDS"] },
        { name: "Jackets", slug: "jackets", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Accessories", slug: "accessories", gender: ["MEN", "WOMEN", "KIDS"] },
    ];

    const categories = [];
    for (const def of categoryDefs) {
        const cat = await prisma.category.upsert({
            where: { slug: def.slug },
            update: { gender: { set: def.gender as any } },
            create: {
                name: def.name,
                slug: def.slug,
                gender: { set: def.gender as any },
                imageUrl: getPlaceholderUrl(400, 400, "CCCCCC", "333333", def.name),
            },
        });
        categories.push(cat);
    }

    // ------------------------
    // COLLECTIONS
    // ------------------------
    console.log("📦 Seeding Collections...");
    const collectionData = [
        { name: "Best Sellers", slug: "best-sellers", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "New Arrivals", slug: "new-arrivals", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Summer Sale 2024", slug: "summer-sale", gender: ["MEN", "WOMEN", "KIDS"] },
        { name: "Men's Premium", slug: "men-premium", gender: ["MEN"] },
        { name: "Women's Trends", slug: "women-trends", gender: ["WOMEN"] },
        { name: "Kids Playroom", slug: "kids-playroom", gender: ["KIDS"] },
    ];

    const collectionMap: Record<string, any> = {};
    for (const data of collectionData) {
        const col = await prisma.collection.upsert({
            where: { slug: data.slug },
            update: { gender: { set: data.gender as any } },
            create: {
                name: data.name,
                slug: data.slug,
                gender: { set: data.gender as any },
            },
        });
        collectionMap[data.slug] = col;
    }

    // ------------------------
    // PLACEMENTS (Banners & Home Structure)
    // ------------------------
    console.log("🖼️ Seeding Placements...");
    const placements = [
        // HOME PAGE
        {
            page: "HOME",
            section: "TOP_BANNER",
            colSlug: "summer-sale",
            isBanner: true,
            order: 1,
            text: "SUMMER SALE - 50% OFF",
        },
        {
            page: "HOME",
            section: "MID_BANNER",
            colSlug: "new-arrivals",
            isBanner: true,
            order: 2,
            text: "CHECK NEW ARRIVALS",
        },
        {
            page: "HOME",
            section: "FEATURED_ROW",
            colSlug: "best-sellers",
            isBanner: false,
            order: 3,
            text: "BEST SELLERS",
        },

        // MEN PAGE
        {
            page: "MEN",
            section: "TOP_BANNER",
            colSlug: "men-premium",
            isBanner: true,
            order: 1,
            text: "MEN'S PREMIUM COLLECTION",
        },

        // WOMEN PAGE
        {
            page: "WOMEN",
            section: "TOP_BANNER",
            colSlug: "women-trends",
            isBanner: true,
            order: 1,
            text: "WOMEN'S LATEST TRENDS",
        },

        // KIDS PAGE
        {
            page: "KIDS",
            section: "TOP_BANNER",
            colSlug: "kids-playroom",
            isBanner: true,
            order: 1,
            text: "KIDS PLAYROOM FAVORITES",
        },
    ];

    for (const p of placements) {
        const col = collectionMap[p.colSlug];
        if (!col) continue;

        // Note: CollectionPlacement doesn't have a unique field besides ID, so we find existing first to avoid bloat
        const existingPlacement = await prisma.collectionPlacement.findFirst({
            where: {
                page: p.page as any,
                section: p.section as any,
                collectionId: col.id,
            },
        });

        if (!existingPlacement) {
            await prisma.collectionPlacement.create({
                data: {
                    page: p.page as any,
                    section: p.section as any,
                    collectionId: col.id,
                    isBanner: p.isBanner,
                    displayOrder: p.order,
                    imageUrl: getPlaceholderUrl(1200, 400, "333333", "FFFFFF", p.text),
                },
            });
        }
    }

    // ------------------------
    // PRODUCT GENERATION
    // ------------------------
    console.log("👕 Seeding Products & Variants...");

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

            // Link to "New Arrivals"
            await prisma.productCollection.upsert({
                where: {
                    productId_collectionId: {
                        productId: product.id,
                        collectionId: collectionMap["new-arrivals"].id,
                    },
                },
                update: {},
                create: {
                    productId: product.id,
                    collectionId: collectionMap["new-arrivals"].id,
                    displayOrder: i,
                },
            });

            // 30% chance to be a Best Seller
            if (Math.random() < 0.3) {
                await prisma.productCollection.upsert({
                    where: {
                        productId_collectionId: {
                            productId: product.id,
                            collectionId: collectionMap["best-sellers"].id,
                        },
                    },
                    update: {},
                    create: {
                        productId: product.id,
                        collectionId: collectionMap["best-sellers"].id,
                        displayOrder: i,
                    },
                });
            }
        }

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

    console.log(`✅ Seed completed! Processed ${PRODUCT_COUNT} products.`);
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
