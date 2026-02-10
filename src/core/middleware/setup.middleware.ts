import express, { type Application, type RequestHandler } from "express";
import cookieParser from "cookie-parser";
import { createSecurityMiddlewares } from "./security.middleware.js";
import { createRequestIdMiddleware } from "./request-id.middleware.js";

export interface MiddlewareConfig {
    customMiddlewares?: RequestHandler[];
}

export function setupMiddleware(app: Application, config: MiddlewareConfig = {}): void {
    // Security middleware (helmet, CORS, rate limiting) - must come first
    createSecurityMiddlewares().forEach((mw) => app.use(mw));

    // Request ID tracking
    app.use(createRequestIdMiddleware());

    // Cookie parsing (required for auth middleware)
    app.use(cookieParser());

    // Custom middlewares (e.g., request logging)
    config.customMiddlewares?.forEach((mw) => app.use(mw));

    // Body parsing with size limits
    app.use(express.json({ limit: "10kb" }));
    app.use(express.urlencoded({ extended: true, limit: "10kb" }));
}
