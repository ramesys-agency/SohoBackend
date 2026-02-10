import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import type { IErrorHandler } from "../interfaces/index.js";
import type { ApiResponse } from "../types/index.js";
import { HttpError } from "../errors/http-errors.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

export class ErrorHandler implements IErrorHandler {
    handle(err: Error, req: Request, res: Response, _next: NextFunction): void {
        // Determine status code
        const statusCode = err instanceof HttpError ? err.statusCode : 500;
        const isServerError = statusCode >= 500;

        // Log error with request context
        const logMeta = {
            requestId: req.requestId,
            method: req.method,
            path: req.path,
            statusCode,
            ...(isServerError && { stack: err.stack }),
        };

        if (isServerError) {
            logger.error(`Request error: ${err.message}`, logMeta);
        } else {
            logger.warn(`Request error: ${err.message}`, logMeta);
        }

        // Build response - hide internal details in production
        const response: ApiResponse<never> & { stack?: string } = {
            success: false,
            error: isServerError && config.isProduction ? "Internal Server Error" : err.message,
            requestId: req.requestId,
        };

        // Include stack trace only in development for debugging
        if (!config.isProduction && err.stack) {
            response.stack = err.stack;
        }

        res.status(statusCode).json(response);
    }

    middleware(): ErrorRequestHandler {
        return (err: Error, req: Request, res: Response, next: NextFunction) => {
            this.handle(err, req, res, next);
        };
    }
}
