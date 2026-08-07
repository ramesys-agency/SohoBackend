import { execFileSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_NAME, adminDatabaseUrl, testDatabaseUrl } from "./vitest.config.js";

/**
 * Create the isolated test database once per run and bring its schema up to
 * date. `db push` is used rather than `migrate deploy` to match how this project
 * applies schema changes.
 */
export default async function setup(): Promise<void> {
    const admin = new pg.Client({ connectionString: adminDatabaseUrl() });
    await admin.connect();

    try {
        const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [
            TEST_DATABASE_NAME,
        ]);
        // Identifier can't be parameterised, and the name is a module constant.
        if (!rowCount) await admin.query(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    } finally {
        await admin.end();
    }

    execFileSync(
        "npx",
        ["prisma", "db", "push", "--config", "prisma/prisma.config.ts", "--accept-data-loss"],
        {
            stdio: "inherit",
            env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
        }
    );
}
