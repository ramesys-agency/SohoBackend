import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { IAuthService, JwtPayload } from "../interfaces/index.js";
import { UnauthorizedError } from "../errors/index.js";

export interface AuthMiddlewareConfig {
    cookieName: string;
    jwtSecret: string;
}

export function createAuthMiddleware(
    authService: IAuthService,
    config: AuthMiddlewareConfig
): RequestHandler {
    return async (req, res, next) => {
        try {
            // 1. Get token from Authorization header or cookie
            let token: string | undefined;

            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith("Bearer ")) {
                token = authHeader.split(" ")[1];
            }

            // Fallback to cookie if enabled/needed, but user requested Bearer priority
            if (!token && req.cookies?.[config.cookieName]) {
                token = req.cookies[config.cookieName];
            }

            if (!token) {
                throw new UnauthorizedError("No auth token provided");
            }

            // 2. Verify JWT signature
            let payload: JwtPayload;
            try {
                payload = jwt.verify(token, config.jwtSecret) as JwtPayload;
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
}
