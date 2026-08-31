import "dotenv/config";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { AuthUtils } from "../modules/auth/auth.utils.js";

/**
 * Provisions the demo account that Google Play and Apple App Review sign in
 * with.
 *
 * Both stores keep the credentials on file and re-use them on *every* update,
 * so the account has to outlive anything that clears the database — a reseed, a
 * destructive `db push`, or a reviewer tapping "Delete account" on the profile
 * screen. This script is idempotent: run it as often as you like, it converges
 * on the same account and the same default address.
 *
 * The app is fully account-gated and delivery is Bangladesh-only, so a reviewer
 * cannot enter an address of their own. The Dhaka address seeded here is what
 * lets them reach the Cash-on-Delivery confirmation step at all — without it
 * checkout dead-ends and the submission gets rejected as "unable to complete
 * the purchase flow".
 *
 * The password is never hard-coded: pass REVIEW_ACCOUNT_PASSWORD, and keep it
 * identical to what is typed into the store consoles.
 */

const EMAIL = process.env.REVIEW_ACCOUNT_EMAIL ?? "sohoadminbd+playreview@gmail.com";
const PASSWORD = process.env.REVIEW_ACCOUNT_PASSWORD;
const FULL_NAME = process.env.REVIEW_ACCOUNT_NAME ?? "Store Review";
const PHONE = process.env.REVIEW_ACCOUNT_PHONE ?? "01700000000";

/**
 * Fixed id so re-runs update the same row instead of piling up addresses on the
 * account. Nothing else in the schema gives an address a natural key.
 */
const ADDRESS_ID = "00000000-0000-4000-8000-000000000a01";

const ADDRESS = {
    type: "Home",
    street: "House 12, Road 7, Dhanmondi",
    postalCode: "1209",
    country: "Bangladesh",
    /** Falls in the INSIDE_DHAKA delivery band — see checkout/delivery-fee.ts. */
    division: "Dhaka",
    district: "Dhaka",
    thana: "Dhanmondi",
};

/**
 * The address form feeds division/district/thana from the courier's own lists,
 * and orders are dispatched to RoadRush using those exact strings. Resolving
 * them out of the synced location tables keeps the seeded address spelled the
 * way the courier spells it; the literals above are only a fallback for a
 * database where `db:sync-locations` has not run yet.
 */
async function resolveLocationNames() {
    const client = prisma.getClient();

    const division = await client.division.findFirst({
        where: { name: { equals: ADDRESS.division, mode: "insensitive" } },
    });

    if (!division) {
        logger.warn(
            "Location tables are not synced — seeding the address with literal names. Run db:sync-locations so they match the courier's list.",
            { division: ADDRESS.division }
        );
        return ADDRESS;
    }

    const district = await client.district.findFirst({
        where: {
            divisionId: division.id,
            name: { equals: ADDRESS.district, mode: "insensitive" },
        },
    });

    if (!district) {
        logger.warn("District not found in the synced list, using the literal name", {
            district: ADDRESS.district,
        });
        return { ...ADDRESS, division: division.name };
    }

    const preferredThana = await client.thana.findFirst({
        where: {
            districtId: district.id,
            name: { equals: ADDRESS.thana, mode: "insensitive" },
        },
    });

    const thana =
        preferredThana ??
        (await client.thana.findFirst({
            where: { districtId: district.id },
            orderBy: { name: "asc" },
        }));

    if (!thana) {
        logger.warn("No thanas synced for the district, using the literal name", {
            thana: ADDRESS.thana,
        });
        return { ...ADDRESS, division: division.name, district: district.name };
    }

    return {
        ...ADDRESS,
        division: division.name,
        district: district.name,
        thana: thana.name,
        postalCode: thana.zipCode ?? ADDRESS.postalCode,
    };
}

async function main() {
    if (!PASSWORD) {
        throw new Error(
            "REVIEW_ACCOUNT_PASSWORD is required. Use the same password that is filed in the Play Console and App Store Connect."
        );
    }

    const client = prisma.getClient();
    const passwordHash = await AuthUtils.hashPassword(PASSWORD);

    // `update` rather than a bare create so a soft-deleted or password-reset
    // account is repaired in place and keeps its order history.
    const user = await client.user.upsert({
        where: { email: EMAIL },
        create: {
            email: EMAIL,
            fullName: FULL_NAME,
            phone: PHONE,
            passwordHash,
            role: "customer",
            isVerified: true,
        },
        update: {
            fullName: FULL_NAME,
            phone: PHONE,
            passwordHash,
            role: "customer",
            isVerified: true,
            isDeleted: false,
            deletedAt: null,
        },
    });

    const location = await resolveLocationNames();
    const dropAddress = [location.street, location.thana, location.district, location.postalCode]
        .filter(Boolean)
        .join(", ");

    // Only one address may be the default, and checkout preselects it.
    await client.address.updateMany({
        where: { userId: user.id, isDefault: true, id: { not: ADDRESS_ID } },
        data: { isDefault: false },
    });

    const address = await client.address.upsert({
        where: { id: ADDRESS_ID },
        create: {
            id: ADDRESS_ID,
            user: { connect: { id: user.id } },
            type: location.type,
            street: location.street,
            dropAddress,
            city: location.district,
            division: location.division,
            district: location.district,
            thana: location.thana,
            postalCode: location.postalCode,
            country: location.country,
            isDefault: true,
        },
        update: {
            user: { connect: { id: user.id } },
            type: location.type,
            street: location.street,
            dropAddress,
            city: location.district,
            division: location.division,
            district: location.district,
            thana: location.thana,
            postalCode: location.postalCode,
            country: location.country,
            isDefault: true,
            isDeleted: false,
        },
    });

    logger.info("Store review account is provisioned", {
        email: user.email,
        userId: user.id,
        addressId: address.id,
        address: dropAddress,
    });
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        logger.error("Failed to provision the store review account", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    });
