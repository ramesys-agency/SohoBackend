import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service.js";
import { SignupSchemaStrict, LoginSchema } from "./auth.schema.js";

export class AuthController {
    private authService: AuthService;

    constructor() {
        this.authService = new AuthService();
    }

    signup = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = SignupSchemaStrict.parse(req).body;
            const result = await this.authService.signup(data);

            res.status(201).json({
                message: "Signup successful",
                data: {
                    user: result.user,
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                },
            });
        } catch (error) {
            next(error);
        }
    };

    login = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = LoginSchema.parse(req).body;
            const result = await this.authService.login(data);

            res.status(200).json({
                message: "Login successful",
                data: {
                    user: result.user,
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                },
            });
        } catch (error) {
            next(error);
        }
    };

    refresh = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const refreshToken = req.body.refreshToken;
            if (!refreshToken) {
                res.status(401).json({ message: "Refresh token not found" });
                return;
            }

            const result = await this.authService.refreshAccessToken(refreshToken);

            res.status(200).json({
                message: "Token refreshed successful",
                data: {
                    accessToken: result.accessToken,
                    refreshToken: result.refreshToken,
                },
            });
        } catch (error) {
            next(error);
        }
    };
}
