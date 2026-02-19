import { Router } from "express";
import { CartController } from "./cart.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export function registerCartModule(): Router {
    const router = Router();
    const controller = new CartController();

    router.get("/", authMiddleware, controller.getAllItems);
    router.get("/add", authMiddleware, controller.addItem);
    router.get("/delete", authMiddleware, controller.deleteItem);

    return router;
}
