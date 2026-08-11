import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function createAuthRouter(): Router {
    const router = Router();
    const controller = new AuthController();

    router.post("/signup", controller.signup);
    router.post("/login", controller.login);
    router.post("/google", controller.googleLogin);
    router.post("/apple", controller.appleLogin);
    router.post("/facebook", controller.facebookLogin);
    router.post("/refresh", controller.refresh);
    router.post("/forgot-password", controller.forgotPassword);
    router.post("/reset-password", controller.resetPassword);
    router.post("/send-otp", controller.sendOtp);
    router.post("/verify-otp", controller.verifyOtp);

    router.get("/me", authMiddleware, controller.getMe);

    return router;
}
