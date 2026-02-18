import { z } from "zod";

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z
        .string()
        .default("3000")
        .transform((v) => parseInt(v, 10)),

    // Database
    DATABASE_URL: z.string().url(),

    // Logging
    LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
    LOKI_URL: z.string().url().optional(),
    LOKI_ENABLED: z
        .string()
        .default("false")
        .transform((v) => v === "true"),
    APP_NAME: z.string().default("ugp-bos"),

    // Security
    CORS_ORIGIN: z.string().default("*"),
    RATE_LIMIT_WINDOW_MS: z
        .string()
        .default("900000")
        .transform((v) => parseInt(v, 10)), // 15 minutes
    RATE_LIMIT_MAX: z
        .string()
        .default("100")
        .transform((v) => parseInt(v, 10)),

    // Auth
    JWT_SECRET: z.string().min(32),
    AUTH_CACHE_TTL: z.coerce.number().default(300), // 5 minutes
    AUTH_ACCESS_TOKEN: z.string().default("access_token"),
    AUTH_REFRESH_TOKEN: z.string().default("refresh_token"),

    // Redis
    REDIS_ENABLED: z
        .string()
        .default("false")
        .transform((v) => v === "true"),
    REDIS_URL: z.string().optional(), // Takes precedence over host/port
    REDIS_HOST: z.string().default("localhost"),
    REDIS_PORT: z
        .string()
        .default("6379")
        .transform((v) => parseInt(v, 10)),
    REDIS_PASSWORD: z.string().optional(),
    REDIS_USERNAME: z.string().optional(),
    REDIS_DB: z
        .string()
        .default("0")
        .transform((v) => parseInt(v, 10)),
    REDIS_TLS: z
        .string()
        .default("false")
        .transform((v) => v === "true"),
    REDIS_KEY_PREFIX: z.string().default("ugp-bos"),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
    const parsed = envSchema.safeParse(process.env);

    if (!parsed.success) {
        console.error("Invalid environment variables:");
        console.error(parsed.error.flatten().fieldErrors);
        process.exit(1);
    }

    return parsed.data;
}
