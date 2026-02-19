import { PrismaClient } from "../src/generated/prisma";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const connectionString = process.env.DATABASE_URL;
const pool = new Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const PRODUCT_COUNT = 120;

const genders = ["Men", "Women", "Kids", "Unisex"];
const fabrics = ["Cotton", "Poly Cotton", "Denim", "Linen"];
const occasions = ["Casual", "Formal", "Festive"];

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
    console.log("🌱 Generating 100+ mock products...");

    // ------------------------
    // COLLECTIONS
    // ------------------------
    await prisma.collection.createMany({
        data: [
            { name: "New Arrivals", slug: "new-arrivals" },
            { name: "Best Sellers", slug: "best-sellers" },
            { name: "Trending Now", slug: "trending-now" },
            { name: "Summer Collection", slug: "summer" },
            { name: "Winter Wear", slug: "winter" },
            { name: "Festive Edit", slug: "festive" },
            { name: "Street Style", slug: "street-style" },
            { name: "Office Wear", slug: "office-wear" },
        ],
        skipDuplicates: true,
    });

    const collections = await prisma.collection.findMany();

    // ------------------------
    // CATEGORY TREE
    // ------------------------
    const rootCategories = {
        clothing: await prisma.category.upsert({
            where: { slug: "clothing" },
            update: {},
            create: { name: "Clothing", slug: "clothing" },
        }),
        shoes: await prisma.category.upsert({
            where: { slug: "shoes" },
            update: {},
            create: { name: "Shoes", slug: "shoes" },
        }),
        accessories: await prisma.category.upsert({
            where: { slug: "accessories" },
            update: {},
            create: { name: "Accessories", slug: "accessories" },
        }),
    };

    const categoryDefs = [
        { name: "Oversized T-Shirts", slug: "oversized-tshirts", parent: rootCategories.clothing },
        { name: "Regular T-Shirts", slug: "regular-tshirts", parent: rootCategories.clothing },
        { name: "Casual Shirts", slug: "casual-shirts", parent: rootCategories.clothing },
        { name: "Formal Shirts", slug: "formal-shirts", parent: rootCategories.clothing },
        { name: "Kurtas", slug: "kurtas", parent: rootCategories.clothing },
        { name: "Sarees", slug: "sarees", parent: rootCategories.clothing },
        { name: "Sneakers", slug: "sneakers", parent: rootCategories.shoes },
        { name: "Sandals", slug: "sandals", parent: rootCategories.shoes },
        { name: "Caps", slug: "caps", parent: rootCategories.accessories },
        { name: "Bags", slug: "bags", parent: rootCategories.accessories },
    ];

    const categories = [];
    for (const def of categoryDefs) {
        const cat = await prisma.category.upsert({
            where: { slug: def.slug },
            update: {},
            create: {
                name: def.name,
                slug: def.slug,
                parentId: def.parent.id,
            },
        });
        categories.push(cat);
    }

    // ------------------------
    // PRODUCT GENERATION
    // ------------------------
    for (let i = 1; i <= PRODUCT_COUNT; i++) {
        const category = randomFrom(categories);
        const gender = randomFrom(genders);
        const basePrice = randomPrice();

        const product = await prisma.product.create({
            data: {
                name: `${category.name} ${i}`,
                description: `High quality ${category.name.toLowerCase()} designed for modern lifestyle.`,
                categoryId: category.id,
                isPublished: true,
                attributes: {
                    gender,
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
                    sku: `${category.slug}-${color.name}-${i}`,
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
