import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service.js";
import {
    SignupSchemaStrict,
    LoginSchema,
    ForgotPasswordSchema,
    ResetPasswordSchema,
    SendOtpSchema,
    VerifyOtpSchema,
} from "./auth.schema.js";


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

    googleLogin = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { idToken } = req.body;
            if (!idToken) {
                res.status(400).json({ message: "idToken is required" });
                return;
            }

            const result = await this.authService.googleAuth({ idToken });

            res.status(200).json({
                message: "Google Authentication successful",
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

    appleLogin = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { identityToken, firstName, lastName } = req.body;
            if (!identityToken) {
                res.status(400).json({ message: "identityToken is required" });
                return;
            }

            const result = await this.authService.appleAuth({ identityToken, firstName, lastName });

            res.status(200).json({
                message: "Apple Authentication successful",
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

    forgotPassword = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = ForgotPasswordSchema.parse(req).body;
            const result = await this.authService.forgotPassword(data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    resetPassword = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = ResetPasswordSchema.parse(req).body;
            const result = await this.authService.resetPassword(data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    getMe = async (req: Request, res: Response, next: NextFunction) => {
        try {
            res.status(200).json({
                message: "User fetched successfully",
                data: {
                    user: req.user,
                },
            });
        } catch (error) {
            next(error);
        }
    };

    sendOtp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = SendOtpSchema.parse(req).body;
            const result = await this.authService.sendOtp(data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };

    verifyOtp = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const data = VerifyOtpSchema.parse(req).body;
            const result = await this.authService.verifyOtp(data);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    };
}
