import "dotenv/config";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
    schema: path.join(import.meta.dirname, "schema"),
    migrations: {
        path: path.join(import.meta.dirname, "migrations"),
        seed: "tsx prisma/seed.ts",
    },
    datasource: {
        url: env("DATABASE_URL"),
    },
});
