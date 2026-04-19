import { PrismaClient } from "../src/generated/prisma";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

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

const genders = ["Men", "Women", "Kids", "Unisex"];
const fabrics = ["Cotton", "Poly Cotton", "Denim", "Linen"];
const occasions = ["Casual", "Formal", "Festive"];

const genderMap: Record<string, string[]> = {
    "Men": ["MEN"],
    "Women": ["WOMEN"],
    "Kids": ["KIDS"],
    "Unisex": ["MEN", "WOMEN"]
};

const colors = [
    { name: "Black", hex: "000000" },
    { name: "White", hex: "FFFFFF" },
    { name: "Navy Blue", hex: "000080" },
    { name: "Red", hex: "FF0000" },
    { name: "Olive", hex: "556B2F" },
];

function randomFrom<T>(arr: T[]) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomPrice(base = 799) {
    return base + Math.floor(Math.random() * 1500);
}

async function main() {
    console.log("🧹 Cleaning database...");
    
    // Ordered deletion to handle foreign keys
    await prisma.productVariantImage.deleteMany().catch(() => {});
    await prisma.inventoryLog.deleteMany().catch(() => {});
    await prisma.cartItem.deleteMany().catch(() => {});
    await prisma.orderItem.deleteMany().catch(() => {});
    await prisma.productVariant.deleteMany().catch(() => {});
    await prisma.productCollection.deleteMany().catch(() => {});
    await prisma.wishlist.deleteMany().catch(() => {});
    await prisma.review.deleteMany().catch(() => {});
    await prisma.orderStatusLog.deleteMany().catch(() => {});
    await prisma.payment.deleteMany().catch(() => {});
    await prisma.order.deleteMany().catch(() => {});
    await prisma.productPriceHistory.deleteMany().catch(() => {});
    await prisma.productSEO.deleteMany().catch(() => {});
    await prisma.product.deleteMany().catch(() => {});
    await prisma.collectionPlacement.deleteMany().catch(() => {});
    await prisma.collection.deleteMany().catch(() => {});
    await prisma.categoryAttribute.deleteMany().catch(() => {});
    await prisma.category.deleteMany().catch(() => {});
    await prisma.address.deleteMany().catch(() => {});
    await prisma.savedPaymentMethod.deleteMany().catch(() => {});
    await prisma.user.deleteMany().catch(() => {});

    // Clean up new tables too
    await (prisma as any).couponCollection?.deleteMany().catch(() => {});
    await (prisma as any).coupon?.deleteMany().catch(() => {});
    await (prisma as any).pickupAddress?.deleteMany().catch(() => {});
    await (prisma as any).area?.deleteMany().catch(() => {});
    await (prisma as any).thana?.deleteMany().catch(() => {});
    await (prisma as any).district?.deleteMany().catch(() => {});
    await (prisma as any).division?.deleteMany().catch(() => {});

    console.log("👤 Creating User & Admin...");
    const passwordHash = await hashPassword("Password@123");
    
    await prisma.user.create({
        data: {
            email: "admin@soho.com",
            fullName: "Admin Soho",
            passwordHash,
            role: "admin",
            isVerified: true
        }
    });

    await prisma.user.create({
        data: {
            email: "user@soho.com",
            fullName: "User Soho",
            passwordHash,
            role: "customer",
            isVerified: true
        }
    });

    console.log("🌱 Generating 100+ mock products...");

    // ------------------------
    // COLLECTIONS
    // ------------------------
    const collectionData = [
        // Top Banners
        {
            name: "Men's Grand Summer Sale",
            slug: "men-top-banner",
            gender: { set: ["MEN" as const] },
        },
        {
            name: "Women's Trending Collection",
            slug: "women-top-banner",
            gender: { set: ["WOMEN" as const] },
        },
        {
            name: "Kids New Arrivals",
            slug: "kids-top-banner",
            gender: { set: ["KIDS" as const] },
        },
        {
            name: "Home Top Offer",
            slug: "home-top-banner",
            gender: { set: ["MEN" as const, "WOMEN" as const, "KIDS" as const] },
        },

        // Mid Banners
        {
            name: "Men's Special Mid Offer",
            slug: "men-mid-banner",
            gender: { set: ["MEN" as const] },
        },
        {
            name: "Women's Special Mid Offer",
            slug: "women-mid-banner",
            gender: { set: ["WOMEN" as const] },
        },
        {
            name: "Home Mid Offer",
            slug: "home-mid-banner",
            gender: { set: ["MEN" as const, "WOMEN" as const, "KIDS" as const] },
        },

        // Normal Collections (Featured, Grid, See All)
        {
            name: "New Arrivals",
            slug: "new-arrivals",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Best Sellers",
            slug: "best-sellers",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Trending Now",
            slug: "trending-now",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Summer Collection",
            slug: "summer",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Winter Wear",
            slug: "winter",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Festive Edit",
            slug: "festive",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Street Style",
            slug: "street-style",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Office Wear",
            slug: "office-wear",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
        {
            name: "Men's Sneakers",
            slug: "men-sneakers",
            gender: { set: ["MEN" as const] },
        },
        {
            name: "Women's Heels",
            slug: "women-heels",
            gender: { set: ["WOMEN" as const] },
        },
        {
            name: "Kids Toys",
            slug: "kids-toys",
            gender: { set: ["KIDS" as const] },
        },
        {
            name: "Kids Clothing",
            slug: "kids-clothing",
            gender: { set: ["KIDS" as const] },
        },
    ];

    for (const data of collectionData) {
        await prisma.collection.upsert({
            where: { slug: data.slug },
            update: data,
            create: data,
        });
    }

    const collections = await prisma.collection.findMany();

    // ------------------------
    // COLLECTION PLACEMENTS
    // ------------------------
    const placements = [
        // HOME Placements
        {
            slug: "home-top-banner",
            page: "HOME" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x500/ff4500/fff&text=Grand+Sale",
        },
        {
            slug: "home-mid-banner",
            page: "HOME" as const,
            section: "MID_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x300/008000/fff&text=Mid+Offer",
        },
        {
            slug: "new-arrivals",
            page: "HOME" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=New",
        },
        {
            slug: "best-sellers",
            page: "HOME" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Best",
        },
        {
            slug: "trending-now",
            page: "HOME" as const,
            section: "GRID_SECTION" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Trending",
        },

        // MEN Placements
        {
            slug: "men-top-banner",
            page: "MEN" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x500/000/fff&text=Men's+Sale",
        },
        {
            slug: "men-mid-banner",
            page: "MEN" as const,
            section: "MID_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x300/333/fff&text=Mid+Season+Sale",
        },
        {
            slug: "street-style",
            page: "MEN" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Street",
        },
        {
            slug: "office-wear",
            page: "MEN" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Office",
        },
        {
            slug: "men-sneakers",
            page: "MEN" as const,
            section: "GRID_SECTION" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Sneakers",
        },

        // WOMEN Placements
        {
            slug: "women-top-banner",
            page: "WOMEN" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x500/ff69b4/fff&text=Women's+Trends",
        },
        {
            slug: "women-mid-banner",
            page: "WOMEN" as const,
            section: "MID_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x300/c71585/fff&text=Mid+Season+Sale",
        },
        {
            slug: "festive",
            page: "WOMEN" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Festive",
        },
        {
            slug: "summer",
            page: "WOMEN" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Summer",
        },
        {
            slug: "women-heels",
            page: "WOMEN" as const,
            section: "GRID_SECTION" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Heels",
        },

        // KIDS Placements
        {
            slug: "kids-top-banner",
            page: "KIDS" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x500/87ceeb/fff&text=Kids+Arrivals",
        },
        {
            slug: "kids-clothing",
            page: "KIDS" as const,
            section: "FEATURED_ROW" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Kids+Clothing",
        },
        {
            slug: "kids-toys",
            page: "KIDS" as const,
            section: "GRID_SECTION" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Toys",
        },

        // CATALOG Placements
        {
            slug: "new-arrivals",
            page: "CATALOG" as const,
            section: "SEE_ALL" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=New",
        },
        {
            slug: "best-sellers",
            page: "CATALOG" as const,
            section: "SEE_ALL" as const,
            isBanner: false,
            imageUrl: "https://dummyimage.com/400x400/000/fff&text=Best",
        },

        // OFFER Placements
        {
            slug: "men-mid-banner",
            page: "OFFER" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x300/333/fff&text=Mid+Season+Sale",
        },
        {
            slug: "women-mid-banner",
            page: "OFFER" as const,
            section: "TOP_BANNER" as const,
            isBanner: true,
            imageUrl: "https://dummyimage.com/1200x300/c71585/fff&text=Mid+Season+Sale",
        },
    ];

    for (const [index, p] of placements.entries()) {
        const collection = collections.find((c) => c.slug === p.slug);
        if (collection) {
            await prisma.collectionPlacement.create({
                data: {
                    collectionId: collection.id,
                    page: p.page,
                    section: p.section,
                    isBanner: p.isBanner,
                    imageUrl: p.imageUrl,
                    displayOrder: index,
                },
            });
        }
    }

    // ------------------------
    // CATEGORY TREE
    // ------------------------
    const categoryDefs = [
        { name: "T-Shirts", slug: "t-shirts", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Shirts", slug: "shirts", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Sarees", slug: "sarees", gender: ["WOMEN"] as any },
        { name: "Kurtas", slug: "kurtas", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Jeans", slug: "jeans", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Sneakers", slug: "sneakers", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Sandals", slug: "sandals", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Caps", slug: "caps", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Bags", slug: "bags", gender: ["MEN", "WOMEN", "KIDS"] as any },
    ];

    const categories = [];
    for (const def of categoryDefs) {
        const cat = await prisma.category.upsert({
            where: { slug: def.slug },
            update: {
                gender: def.gender,
            },
            create: {
                name: def.name,
                slug: def.slug,
                gender: def.gender,
            },
        });
        categories.push(cat);
    }

    // ------------------------
    // PRODUCT GENERATION
    // ------------------------
    for (let i = 1; i <= PRODUCT_COUNT; i++) {
        const category = randomFrom(categories);
        const genderLabel = randomFrom(genders);
        const basePrice = randomPrice();

        const product = await prisma.product.create({
            data: {
                name: `${category.name} ${i}`,
                description: `High quality ${category.name.toLowerCase()} designed for modern lifestyle.`,
                categoryId: category.id,
                isPublished: true,
                gender: { set: genderMap[genderLabel] as any },
                attributes: {
                    gender: genderLabel,
                    fabric: randomFrom(fabrics),
                    occasion: randomFrom(occasions),
                },
            },
        });

        // ------------------------
        // COLLECTIONS (2–3 per product)
        // ------------------------
        const shuffledCollections = [...collections].sort(() => 0.5 - Math.random());
        await prisma.productCollection.createMany({
            data: shuffledCollections.slice(0, 2 + (i % 2)).map((c) => ({
                productId: product.id,
                collectionId: c.id,
            })),
        });

        // ------------------------
        // VARIANTS + IMAGES
        // ------------------------
        const variantColors = colors.sort(() => 0.5 - Math.random()).slice(0, 2);

        for (const color of variantColors) {
            const variant = await prisma.productVariant.create({
                data: {
                    productId: product.id,
                    sku: `${category.slug}-${color.name.toLowerCase().replace(/\s+/g, '-')}-${i}`,
                    size: "M",
                    colorName: color.name,
                    colorValue: `#${color.hex}`,
                    stockQty: 10 + (i % 20),
                    basePrice,
                    originalPrice: basePrice + 400,
                },
            });

            await prisma.productVariantImage.createMany({
                data: [
                    {
                        variantId: variant.id,
                        imageUrl: `https://dummyimage.com/600x800/${color.hex}/ffffff&text=${encodeURIComponent(
                            category.name + " " + color.name
                        )}`,
                        colorRef: color.name,
                        isPrimary: true,
                        displayOrder: 1,
                    },
                    {
                        variantId: variant.id,
                        imageUrl: `https://dummyimage.com/600x800/${color.hex}/ffffff&text=Back+View`,
                        colorRef: color.name,
                        displayOrder: 2,
                    },
                ],
            });
        }
    }

    console.log(`✅ Successfully generated ${PRODUCT_COUNT} products`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
