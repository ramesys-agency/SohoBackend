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

const genders = ["Men", "Women", "Kids", "Unisex"];
const fabrics = ["Cotton", "Poly Cotton", "Denim", "Linen"];
const occasions = ["Casual", "Formal", "Festive"];

const genderMap: Record<string, string[]> = {
    Men: ["MEN"],
    Women: ["WOMEN"],
    Kids: ["KIDS"],
    Unisex: ["MEN", "WOMEN"],
};

const SIZES = ["S", "M", "L", "XL", "XXL"];

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
    console.log("🌱 Starting seed (Non-destructive)...");

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

    console.log("🌱 Generating mock data (if missing)...");

    // Check if we already have products
    const existingProducts = await prisma.product.count();
    if (existingProducts > 0) {
        console.log("✅ Data already exists. Skipping bulk product generation.");
        return;
    }

    // ------------------------
    // COLLECTIONS
    // ------------------------
    const collectionData = [
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
        { name: "Kids New Arrivals", slug: "kids-top-banner", gender: { set: ["KIDS" as const] } },
        {
            name: "Home Top Offer",
            slug: "home-top-banner",
            gender: { set: ["MEN" as const, "WOMEN" as const, "KIDS" as const] },
        },
        {
            name: "New Arrivals",
            slug: "new-arrivals",
            gender: { set: ["MEN" as const, "WOMEN" as const] },
        },
    ];

    for (const data of collectionData) {
        await prisma.collection.upsert({
            where: { slug: data.slug },
            update: data,
            create: data,
        });
    }

    // ------------------------
    // CATEGORY TREE
    // ------------------------
    const categoryDefs = [
        { name: "T-Shirts", slug: "t-shirts", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Shirts", slug: "shirts", gender: ["MEN", "WOMEN", "KIDS"] as any },
        { name: "Kurtas", slug: "kurtas", gender: ["MEN", "WOMEN", "KIDS"] as any },
    ];

    const categories = [];
    for (const def of categoryDefs) {
        const cat = await prisma.category.upsert({
            where: { slug: def.slug },
            update: { gender: def.gender },
            create: { name: def.name, slug: def.slug, gender: def.gender },
        });
        categories.push(cat);
    }

    // ------------------------
    // PRODUCT GENERATION
    // ------------------------
    for (let i = 1; i <= PRODUCT_COUNT; i++) {
        const category = randomFrom(categories);
        const genderLabel = randomFrom(genders);
        if (!category || !genderLabel) continue;

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
        // VARIANTS (Multiple variants for most products)
        // ------------------------
        const numVariants = Math.random() > 0.3 ? Math.floor(Math.random() * 4) + 2 : 1;
        const usedSkus = new Set<string>();

        for (let j = 0; j < numVariants; j++) {
            const color = randomFrom(colors);
            const size = randomFrom(SIZES);
            const sku = `${category.slug}-${color.name.toLowerCase().replace(/\s+/g, "-")}-${size.toLowerCase()}-${i}`;

            if (usedSkus.has(sku)) continue;
            usedSkus.add(sku);

            await prisma.productVariant.upsert({
                where: { sku },
                update: {},
                create: {
                    productId: product.id,
                    sku,
                    size,
                    colorName: color.name,
                    colorValue: `#${color.hex}`,
                    stockQty: Math.floor(Math.random() * 100),
                    basePrice,
                    originalPrice: basePrice + 400,
                    isDefault: usedSkus.size === 1,
                },
            });
        }
    }

    console.log(`✅ Successfully generated ${PRODUCT_COUNT} products`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
