import "dotenv/config";
import { GenderType, PageType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * One-time migration from CategoryImage rows to CATEGORY_CIRCLE placements.
 *
 * The catalog circle row used to be configured through CategoryImage — one row
 * per (category, gender) carrying an image, an order and a visibility flag,
 * editable only from the category form. Circles are now placements like every
 * other slot on a catalog page, which is what gives them an editable product
 * list on top of the category's own products.
 *
 * This creates one CATEGORY_CIRCLE placement per active CategoryImage row,
 * preserving image, order and visibility. The CategoryImage rows are left
 * untouched so the old query keeps working until the app ships; delete them in
 * a later pass once the placements are live.
 *
 * Idempotent: a category that already has a circle on a page is skipped, so
 * re-running never duplicates.
 *
 *   npx tsx --env-file=.env src/scripts/migrate-category-images-to-placements.ts --dry-run
 *   npx tsx --env-file=.env src/scripts/migrate-category-images-to-placements.ts
 */

const GENDER_PAGE: Record<GenderType, PageType> = {
    MEN: PageType.MEN,
    WOMEN: PageType.WOMEN,
    KIDS: PageType.KIDS,
};

const slugify = (value: string): string =>
    value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)+/g, "");

async function uniqueSlug(base: string): Promise<string> {
    const db = prisma.getClient();
    const root = slugify(base) || "category-circle";
    let candidate = root;
    let counter = 1;

    while (await db.collection.findFirst({ where: { slug: candidate }, select: { id: true } })) {
        candidate = `${root}-${counter++}`;
    }

    return candidate;
}

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const db = prisma.getClient();

    const rows = await db.categoryImage.findMany({
        where: { isActive: true },
        include: { category: { select: { id: true, name: true, imageUrl: true, deletedAt: true } } },
        orderBy: [{ gender: "asc" }, { displayOrder: "asc" }],
    });

    logger.info(`Found ${rows.length} active CategoryImage rows`);

    let created = 0;
    let skipped = 0;

    for (const row of rows) {
        const page = GENDER_PAGE[row.gender];

        if (row.category.deletedAt) {
            logger.warn(`Skipping ${row.category.name} (${row.gender}) — category is deleted`);
            skipped++;
            continue;
        }

        const existing = await db.collectionPlacement.findFirst({
            where: { page, section: "CATEGORY_CIRCLE", sourceCategoryId: row.categoryId },
            select: { id: true },
        });

        if (existing) {
            logger.info(`Skipping ${row.category.name} (${page}) — circle already exists`);
            skipped++;
            continue;
        }

        if (dryRun) {
            logger.info(`Would create circle: ${row.category.name} on ${page}`);
            created++;
            continue;
        }

        // The placement's own image wins, then the category's neutral one —
        // never another gender's, which is the rule the old query used.
        const imageUrl = row.imageUrl || row.category.imageUrl || null;
        const slug = await uniqueSlug(`${row.category.name}-${row.gender}`);

        await db.$transaction(async (tx) => {
            const collection = await tx.collection.create({
                data: {
                    name: row.category.name,
                    slug,
                    gender: { set: [row.gender] },
                    isActive: true,
                },
            });

            await tx.collectionPlacement.create({
                data: {
                    collectionId: collection.id,
                    sourceCategoryId: row.categoryId,
                    page,
                    section: "CATEGORY_CIRCLE",
                    imageUrl,
                    displayOrder: row.displayOrder,
                    isActive: row.isActive,
                    isBanner: false,
                },
            });
        });

        logger.info(`Created circle: ${row.category.name} on ${page}`);
        created++;
    }

    logger.info(
        `${dryRun ? "[dry run] " : ""}Done — ${created} circle placements created, ${skipped} skipped`
    );
}

main()
    .then(async () => {
        await prisma.getClient().$disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        logger.error("Error migrating category images to placements", {
            error: error instanceof Error ? error.message : String(error),
        });
        await prisma.getClient().$disconnect();
        process.exit(1);
    });
