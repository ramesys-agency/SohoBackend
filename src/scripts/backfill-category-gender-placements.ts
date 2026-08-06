import "dotenv/config";
import { GenderType } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

/**
 * One-time backfill for admin-configurable category gender tabs.
 *
 * Category visibility in the mobile catalog's Men/Women/Kids tabs used to be
 * derived at query time from a three-branch OR: the category had products of
 * that gender, OR it had a gender-specific image, OR a child matched either.
 * Visibility is now an explicit CategoryImage row that merchandising controls.
 *
 * Without this backfill, categories that only ever qualified via that implicit
 * rule have no row and would vanish from the app the moment the new query ships.
 * This materialises a row for every (category, gender) pair the old rule matched.
 *
 * Existing rows are never modified — an admin's configured image, order, and
 * visibility always win over anything inferred here.
 *
 * Deliberate difference from the old rule: products are counted only when
 * published and not soft-deleted. The old rule counted drafts and deleted stock,
 * which is how categories with nothing purchasable in them reached the tabs (and
 * opened onto an empty product list, since the product endpoint asks for
 * isPublished: true). Pairs that qualified only on unpublished or deleted stock
 * are reported at the end rather than created, so the call to feature them stays
 * a merchandising decision.
 *
 *   npm run db:backfill-category-placements -- --dry-run
 *   npm run db:backfill-category-placements
 */

const GENDERS: GenderType[] = [GenderType.MEN, GenderType.WOMEN, GenderType.KIDS];

type PlacementSeed = {
    categoryId: string;
    categoryName: string;
    gender: GenderType;
    reason: string;
};

async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const db = prisma.getClient();

    logger.info(
        dryRun
            ? "Backfilling category gender placements (DRY RUN — no writes)"
            : "Backfilling category gender placements"
    );

    const categories = await db.category.findMany({
        where: { deletedAt: null },
        select: {
            id: true,
            name: true,
            genderImages: { select: { gender: true } },
            products: {
                where: { isPublished: true, deletedAt: null },
                select: { gender: true },
            },
            children: {
                where: { deletedAt: null },
                select: {
                    genderImages: { select: { gender: true } },
                    products: {
                        where: { isPublished: true, deletedAt: null },
                        select: { gender: true },
                    },
                },
            },
        },
    });

    // Pairs that the old unfiltered rule would have matched but this one does not,
    // i.e. the category's only stock for that gender is a draft or soft-deleted.
    const draftOnly = await db.category.findMany({
        where: { deletedAt: null },
        select: {
            id: true,
            name: true,
            products: {
                where: { OR: [{ isPublished: false }, { NOT: { deletedAt: null } }] },
                select: { gender: true },
            },
        },
    });

    const toCreate: PlacementSeed[] = [];

    for (const category of categories) {
        const existing = new Set(category.genderImages.map((image) => image.gender));

        for (const gender of GENDERS) {
            if (existing.has(gender)) continue;

            const hasOwnProducts = category.products.some((product) =>
                product.gender.includes(gender)
            );
            const childMatches = category.children.some(
                (child) =>
                    child.products.some((product) => product.gender.includes(gender)) ||
                    child.genderImages.some((image) => image.gender === gender)
            );

            if (!hasOwnProducts && !childMatches) continue;

            toCreate.push({
                categoryId: category.id,
                categoryName: category.name,
                gender,
                reason: hasOwnProducts ? "published products" : "matching child category",
            });
        }
    }

    for (const seed of toCreate) {
        logger.info(`  + ${seed.categoryName} → ${seed.gender} (${seed.reason})`);
    }

    if (dryRun) {
        logger.info(`DRY RUN: would create ${toCreate.length} placement(s)`);
    } else if (toCreate.length > 0) {
        // skipDuplicates guards the (categoryId, gender) unique constraint so the
        // script stays safe to re-run.
        const result = await db.categoryImage.createMany({
            data: toCreate.map((seed) => ({
                categoryId: seed.categoryId,
                gender: seed.gender,
                imageUrl: null,
                isActive: true,
                displayOrder: 0,
            })),
            skipDuplicates: true,
        });
        logger.info(`Created ${result.count} placement(s)`);
    } else {
        logger.info("No placements needed — every visible category already has a row");
    }

    const created = new Set(toCreate.map((seed) => `${seed.categoryId}:${seed.gender}`));
    const skipped: string[] = [];

    for (const category of draftOnly) {
        for (const gender of GENDERS) {
            if (created.has(`${category.id}:${gender}`)) continue;
            if (!category.products.some((product) => product.gender.includes(gender))) continue;
            skipped.push(`${category.name} → ${gender}`);
        }
    }

    if (skipped.length > 0) {
        logger.warn(
            `${skipped.length} pair(s) were NOT created: their only ${""}stock for that gender is unpublished or soft-deleted. ` +
                "These were previously visible in the app but opened onto an empty product list. " +
                "Publish the products or enable the placement manually in the admin panel:"
        );
        for (const pair of skipped) {
            logger.warn(`  - ${pair}`);
        }
    }

    const totals = await db.categoryImage.groupBy({
        by: ["gender"],
        where: { isActive: true },
        _count: { _all: true },
    });
    for (const total of totals) {
        logger.info(`Active placements for ${total.gender}: ${total._count._all}`);
    }
}

main()
    .then(async () => {
        await prisma.getClient().$disconnect();
        process.exit(0);
    })
    .catch(async (error) => {
        logger.error("Error during category gender placement backfill", {
            error: error instanceof Error ? error.message : String(error),
        });
        await prisma.getClient().$disconnect();
        process.exit(1);
    });
