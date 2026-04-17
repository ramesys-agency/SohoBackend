import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../interfaces/index.js";
import { ForbiddenError, UnauthorizedError } from "../errors/index.js";
import { config } from "../../config/index.js";
import { authService } from "../../config/auth.js";

export const authMiddleware: RequestHandler = async (req, res, next) => {
    try {
        // 1. Get token from Authorization header or cookie
        let token: string | undefined;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }

        if (!token) {
            throw new UnauthorizedError("No auth token provided");
        }

        // 2. Verify JWT signature
        let payload: JwtPayload;
        try {
            payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
        } catch (error) {
            if (error instanceof jwt.TokenExpiredError) {
                throw new UnauthorizedError("Token expired");
            }
            if (error instanceof jwt.JsonWebTokenError) {
                throw new UnauthorizedError("Invalid token");
            }
            throw error;
        }

        // 3. Verify user in DB (with cache)
        const user = await authService.verifyAndGetUser(payload.userId, payload.role);
        if (!user) {
            throw new UnauthorizedError("User not found");
        }

        // 5. Attach to request
        req.user = user;
        next();
    } catch (error) {
        next(error);
    }
};

export const optionalAuthMiddleware: RequestHandler = async (req, res, next) => {
    try {
        let token: string | undefined;

        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
            token = authHeader.split(" ")[1];
        }

        if (!token) {
            return next();
        }

        let payload: JwtPayload;
        try {
            payload = jwt.verify(token, config.auth.jwtSecret) as JwtPayload;
        } catch {
            return next();
        }

        const user = await authService.verifyAndGetUser(payload.userId, payload.role);
        if (user) {
            req.user = user;
        }

        next();
    } catch {
        next();
    }
};

export const adminMiddleware: RequestHandler = async (req, res, next) => {
    try {
        if (!req.user || req.user.role !== "admin") {
            throw new ForbiddenError("Admin access required");
        }
        next();
    } catch (error) {
        next(error);
    }
};
