import "dotenv/config";
import { defineConfig } from "vitest/config";

export const TEST_DATABASE_NAME = "soho_test_db";

/**
 * Tests run against a dedicated database on the same server, so they exercise
 * the real atomic-claim SQL the queue depends on without ever touching
 * development data.
 *
 * A separate database rather than a separate schema on purpose: the pg driver
 * adapter ignores `?schema=`, so a schema-based split would silently point the
 * client back at `public` — and the tests truncate every table they touch.
 */
export function testDatabaseUrl(): string {
    const base = process.env.DATABASE_URL;
    if (!base) throw new Error("DATABASE_URL must be set to run the test suite");

    const url = new URL(base);
    url.pathname = `/${TEST_DATABASE_NAME}`;
    url.searchParams.delete("schema");
    return url.toString();
}

/** Same server, the always-present maintenance database — used to CREATE the test one. */
export function adminDatabaseUrl(): string {
    const url = new URL(process.env.DATABASE_URL as string);
    url.pathname = "/postgres";
    url.searchParams.delete("schema");
    return url.toString();
}

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["src/**/*.test.ts"],
        globalSetup: ["./vitest.global-setup.ts"],
        // One shared schema — files must not race each other truncating it.
        fileParallelism: false,
        testTimeout: 30_000,
        hookTimeout: 60_000,
        env: {
            DATABASE_URL: testDatabaseUrl(),
            NODE_ENV: "test",
            // The worker's Redis lock is optional by design; leaving it off keeps
            // the tests honest about the database-level claim being sufficient.
            REDIS_ENABLED: "false",
            LOG_LEVEL: "error",
            // Disables the background timer and the post-enqueue kick, so the
            // singleton service (which holds a real Expo client) never reaches
            // the network. Tests drive the queue explicitly through a worker
            // built around a fake Expo instead; runOnce() is not gated on this.
            PUSH_JOB_ENABLED: "false",
            PUSH_RETRY_DELAYS_MINUTES: "1,5,30",
            PUSH_RECEIPT_DELAY_MINUTES: "15",
            PUSH_JOB_STALE_CLAIM_MINUTES: "10",
        },
    },
});
