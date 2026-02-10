import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import type { IAuthService, JwtPayload } from "../interfaces/index.js";
import { UnauthorizedError, ForbiddenError } from "../errors/index.js";

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
            // 1. Get token from cookie
            const token = req.cookies?.[config.cookieName];
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

            // 3. Verify user/role in DB (with cache)
            const user = await authService.verifyAndGetUser(payload.userId, payload.roleId);
            if (!user) {
                throw new UnauthorizedError("User or role not found");
            }

            // 4. Check status
            if (user.status !== "ACTIVE") {
                throw new ForbiddenError("User account is inactive");
            }
            if (user.role.status !== "ACTIVE") {
                throw new ForbiddenError("Role is inactive");
            }

            // 5. Attach to request
            req.user = user;
            next();
        } catch (error) {
            next(error);
        }
    };
}
