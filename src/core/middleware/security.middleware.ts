import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import type { RequestHandler } from "express";
import { config } from "../../config/index.js";

export function createHelmetMiddleware(): RequestHandler {
    return helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:", "https:"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
        crossOriginEmbedderPolicy: false, // Disable for API usage
    });
}

export function createCorsMiddleware(): RequestHandler {
    const origin = config.security.corsOrigin;

    return cors({
        origin: origin === "*" ? true : origin.split(",").map((o) => o.trim()),
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
        exposedHeaders: ["X-Request-ID"],
        credentials: true,
        maxAge: 86400, // 24 hours
    });
}

export function createRateLimitMiddleware(): RequestHandler {
    return rateLimit({
        windowMs: config.security.rateLimitWindowMs,
        max: config.security.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            error: "Too many requests, please try again later.",
        },
        skip: (req) => config.security.rateLimitSkipPaths.includes(req.path),
    });
}

export function createSecurityMiddlewares(): RequestHandler[] {
    return [createHelmetMiddleware(), createCorsMiddleware(), createRateLimitMiddleware()];
}
