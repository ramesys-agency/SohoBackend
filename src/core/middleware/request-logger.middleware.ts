import type { Request, Response, NextFunction } from "express";
import { logger } from "../../config/logger.js";

export function createRequestLoggerMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const start = Date.now();
        const { method, originalUrl } = req;

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
