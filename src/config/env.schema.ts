import { z } from "zod";

const envSchema = z.object({
    // Server
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z
        .string()
        .default("3000")
        .transform((v) => parseInt(v, 10)),
    FRONTEND_URL: z.string().url().default("http://localhost:3000"),

    // Database
    DATABASE_URL: z.string().url(),

    // Logging
    LOG_LEVEL: z.enum(["error", "warn", "info", "http", "debug"]).default("info"),
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
    GOOGLE_CLIENT_ID: z.string().optional(),
    APPLE_CLIENT_ID: z.string().optional(),

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

    // Storage
    STORAGE: z.enum(["minio", "s3"]).default("minio"),
    BUCKET_NAME: z.string(),
    ACCESS_KEY: z.string(),
    SECRET_KEY: z.string(),
    AWS_REGION: z.string().default("us-east-1"),
    ENDPOINT: z.string().url().optional(),
    STORAGE_PUBLIC_ENDPOINT: z.string().url().optional(),
    
    // Logistics
    ROADRUSH_BASE_URL: z.string().url().default("https://www.roadrush.xyz/api/customer"),
    ROADRUSH_USERNAME: z.string().optional(),
    ROADRUSH_PASSWORD: z.string().optional(),
    // Merchant pickup (sender) address id on RoadRush. Leave unset to resolve it
    // automatically from the account's sender-address list.
    ROADRUSH_PICKUP_ADDRESS_ID: z.preprocess(
        (v) => (v === "" ? undefined : v),
        z.coerce.number().int().positive().optional()
    ),
    // Background polling for RoadRush status changes (they have no webhook).
    // Disable if an external cron drives /orders/admin/poll-statuses instead.
    ORDER_STATUS_POLL_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v === "true"),
    ORDER_STATUS_POLL_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
    ORDER_STATUS_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(50),

    // Checkout stock reservation. Disabling only turns off the 5-minute hold —
    // orders still decrement stock atomically and still refuse to oversell.
    CHECKOUT_RESERVATION_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v === "true"),
    CHECKOUT_RESERVATION_TTL_MINUTES: z.coerce.number().positive().default(5),
    // Upper bound on how long one checkout may keep renewing its hold, so an
    // app left open on the payment screen can't sit on stock indefinitely.
    CHECKOUT_MAX_HOLD_MINUTES: z.coerce.number().positive().default(20),
    RESERVATION_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

    // Logistics retry queue. Delays are applied after the immediate attempt, so
    // "5,30,120" means 1 immediate try + 3 retries at +5m, +30m and +2h.
    LOGISTICS_JOB_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v === "true"),
    LOGISTICS_JOB_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    LOGISTICS_JOB_BATCH_SIZE: z.coerce.number().int().positive().default(20),
    LOGISTICS_RETRY_DELAYS_MINUTES: z
        .string()
        .default("5,30,120")
        .transform((v) =>
            v
                .split(",")
                .map((part) => Number(part.trim()))
                .filter((n) => Number.isFinite(n) && n >= 0)
        )
        .refine((delays) => delays.length > 0, {
            message: "LOGISTICS_RETRY_DELAYS_MINUTES must list at least one delay",
        }),
    // A job claimed by a process that then died is handed back after this long.
    LOGISTICS_JOB_STALE_CLAIM_MINUTES: z.coerce.number().int().positive().default(10),

    // Push notification queue. Delivery is queued rather than fired inline, so a
    // phone that is offline, or an Expo outage, only delays a notification
    // instead of losing it.
    PUSH_JOB_ENABLED: z
        .string()
        .default("true")
        .transform((v) => v === "true"),
    PUSH_JOB_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
    PUSH_JOB_BATCH_SIZE: z.coerce.number().int().positive().default(20),
    // Applied after the immediate attempt, so "1,5,30" means 1 try now plus
    // retries at +1m, +5m and +30m.
    PUSH_RETRY_DELAYS_MINUTES: z
        .string()
        .default("1,5,30")
        .transform((v) =>
            v
                .split(",")
                .map((part) => Number(part.trim()))
                .filter((n) => Number.isFinite(n) && n >= 0)
        )
        .refine((delays) => delays.length > 0, {
            message: "PUSH_RETRY_DELAYS_MINUTES must list at least one delay",
        }),
    PUSH_JOB_STALE_CLAIM_MINUTES: z.coerce.number().int().positive().default(10),
    // Expo only has receipts a few minutes after accepting a push. Polling
    // earlier just returns "not ready yet".
    PUSH_RECEIPT_DELAY_MINUTES: z.coerce.number().int().positive().default(15),
    // How long Expo/FCM/APNs should hold a message for a device that is offline.
    // This is what makes a push survive "mobile data was turned off". Default 7d.
    PUSH_TTL_SECONDS: z.coerce.number().int().positive().default(604800),
    // Optional but recommended by Expo — required once push security is enabled
    // on the project, and it lifts the anonymous rate limit.
    EXPO_ACCESS_TOKEN: z.string().optional(),
    // Delivered/failed jobs are kept this long for auditing, then swept.
    PUSH_JOB_RETENTION_DAYS: z.coerce.number().int().positive().default(14),

    // Who to email when an order falls back to manual shipping (comma separated).
    ADMIN_ALERT_EMAILS: z
        .string()
        .optional()
        .transform((v) =>
            (v ?? "")
                .split(",")
                .map((email) => email.trim())
                .filter(Boolean)
        ),

    // License
    LICENSE_KEY: z.string().optional(),
    LICENSE_SERVICE_URL: z.string().url().optional(),

    // SMTP (Nodemailer)
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.string().optional().transform((v) => v ? parseInt(v, 10) : 587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().optional().default("Soho <noreply@soho.com>"),
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
