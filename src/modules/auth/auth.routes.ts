import { Router } from "express";
import { AuthController } from "./auth.controller.js";

export function createAuthRouter(): Router {
    const router = Router();
    const controller = new AuthController();

    router.post("/signup", controller.signup);
    router.post("/login", controller.login);
    router.post("/refresh", controller.refresh);

    return router;
}
