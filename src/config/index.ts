import { validateEnv } from "./env.schema.js";

const env = validateEnv();

export const config = {
    port: env.PORT,
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",

    app: {
        frontendUrl: env.FRONTEND_URL,
    },

    database: {
        url: env.DATABASE_URL,
        pool: {
            min: 2,
            max: 10,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 5000,
        },
    },

    logging: {
        level: env.LOG_LEVEL,
        lokiUrl: env.LOKI_URL || "http://localhost:3100",
        lokiEnabled: env.LOKI_ENABLED,
        lokiTimeoutMs: 5000,
        appName: env.APP_NAME,
    },

    security: {
        corsOrigin: env.CORS_ORIGIN,
        rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MS,
        rateLimitMax: env.RATE_LIMIT_MAX,
        rateLimitSkipPaths: ["/health", "/health/live"] as string[],
    },

    auth: {
        jwtSecret: env.JWT_SECRET,
        cacheTtl: env.AUTH_CACHE_TTL,
        accessToken: env.AUTH_ACCESS_TOKEN,
        refreshToken: env.AUTH_REFRESH_TOKEN,
    },

    redis: {
        enabled: env.REDIS_ENABLED,
        url: env.REDIS_URL,
        host: env.REDIS_HOST,
        port: env.REDIS_PORT,
        password: env.REDIS_PASSWORD,
        username: env.REDIS_USERNAME,
        db: env.REDIS_DB,
        tls: env.REDIS_TLS,
        keyPrefix: env.REDIS_KEY_PREFIX,
    },

    storage: {
        type: env.STORAGE,
        bucket: env.BUCKET_NAME,
        accessKey: env.ACCESS_KEY,
        secretKey: env.SECRET_KEY,
        region: env.AWS_REGION,
        endpoint: env.ENDPOINT,
    },
    
    logistics: {
        baseUrl: env.ROADRUSH_BASE_URL,
        username: env.ROADRUSH_USERNAME,
        password: env.ROADRUSH_PASSWORD,
    },
} as const;

