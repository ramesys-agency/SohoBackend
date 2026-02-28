import { Router } from "express";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";
import { CartController } from "./cart.controller.js";

export function registerCartModule(): Router {
    const router = Router();
    const controller = new CartController();

    router.get("/", authMiddleware, controller.getAllItems);
    router.get("/add", authMiddleware, controller.addItem);
    router.get("/delete", authMiddleware, controller.deleteItem);
    router.get("/decrement", authMiddleware, controller.decrementItem);

    return router;
}
