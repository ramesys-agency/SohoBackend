import type { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import type { IErrorHandler } from "../interfaces/index.js";
import type { ApiResponse } from "../types/index.js";
import { HttpError } from "../errors/http-errors.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";

/** Duck-typed so the handler doesn't need multer's types at runtime. */
function isMulterError(err: Error): boolean {
    return err.name === "MulterError";
}

export class ErrorHandler implements IErrorHandler {
    handle(err: Error, req: Request, res: Response, _next: NextFunction): void {
        // Determine status code. An oversized or unexpected upload is the
        // client's mistake, not a server fault — multer signals those with its
        // own error class rather than an HttpError.
        const statusCode = err instanceof HttpError ? err.statusCode : isMulterError(err) ? 413 : 500;
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

        // Machine-readable failure details (e.g. which items are out of stock)
        // travel back to the client so it can react to the specifics.
        if (err instanceof HttpError && err.details !== undefined) {
            (response as unknown as Record<string, unknown>).data = err.details;
        }

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
