import crypto from "crypto";
import type { RequestHandler } from "express";

declare global {
    namespace Express {
        interface Request {
            requestId: string;
        }
    }
}

export function createRequestIdMiddleware(): RequestHandler {
    return (req, res, next) => {
        // Use existing X-Request-ID header if provided, otherwise generate one
        // Handle array case (multiple headers) by using the first value
        const headerValue = req.headers["x-request-id"];
        const requestId =
            (Array.isArray(headerValue) ? headerValue[0] : headerValue) || crypto.randomUUID();

        req.requestId = requestId;
        res.setHeader("X-Request-ID", requestId);

        next();
    };
}
