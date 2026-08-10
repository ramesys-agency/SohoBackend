import { Router } from "express";
import { HomePromoController } from "./home-promo.controller.js";
import { upload } from "../upload/upload.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const homePromoRoutes = Router();
const controller = new HomePromoController();

// Public Routes — the app's home screen reads these.
homePromoRoutes.get("/", controller.getAll);
homePromoRoutes.get("/:id", controller.getById);

// Admin Routes
homePromoRoutes.post(
    "/",
    authMiddleware,
    adminMiddleware,
    upload.single("image"),
    controller.create
);
homePromoRoutes.put(
    "/:id",
    authMiddleware,
    adminMiddleware,
    upload.single("image"),
    controller.update
);
homePromoRoutes.delete("/:id", authMiddleware, adminMiddleware, controller.delete);
