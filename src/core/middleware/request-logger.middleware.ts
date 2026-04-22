import type { Request, Response, NextFunction } from "express";
import { logger } from "../../config/logger.js";

export function createRequestLoggerMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const { method, originalUrl } = req;

        // Log when request lands
        logger.info(`${method} ${originalUrl} Request Landing`, {
            method,
            path: originalUrl,
            query: req.query,
            body: method !== "GET" ? req.body : undefined,
        });

        const start = Date.now();

        res.on("finish", () => {
            const duration = Date.now() - start;
            const statusCode = res.statusCode;

            logger.http(`${method} ${originalUrl}`, {
                method,
                path: originalUrl,
                statusCode,
                duration: `${duration}ms`,
            });
        });

        next();
    };
}
