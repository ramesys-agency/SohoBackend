import type { Request, Response, NextFunction } from "express";
import { logger } from "../../config/logger.js";

export function createRequestLoggerMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
        const start = Date.now();

        res.on("finish", () => {
            const duration = Date.now() - start;
            logger.http(`${req.method} ${req.path}`, {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                duration: `${duration}ms`,
                userAgent: req.get("user-agent"),
            });
        });

        next();
    };
}
