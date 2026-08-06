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
        googleClientId: env.GOOGLE_CLIENT_ID,
        appleClientId: env.APPLE_CLIENT_ID,
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
        publicEndpoint: env.STORAGE_PUBLIC_ENDPOINT,
    },
    
    logistics: {
        baseUrl: env.ROADRUSH_BASE_URL,
        username: env.ROADRUSH_USERNAME,
        password: env.ROADRUSH_PASSWORD,
        pickupAddressId: env.ROADRUSH_PICKUP_ADDRESS_ID,
        pollEnabled: env.ORDER_STATUS_POLL_ENABLED,
        pollIntervalMinutes: env.ORDER_STATUS_POLL_INTERVAL_MINUTES,
        pollBatchSize: env.ORDER_STATUS_POLL_BATCH_SIZE,
    },
    
    license: {
        key: env.LICENSE_KEY,
        serviceUrl: env.LICENSE_SERVICE_URL,
    },
    
    mail: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM,
    },
} as const;

