import { Router } from "express";
import { AppPlacementController } from "./app-placement.controller.js";
import { upload } from "../upload/upload.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const appPlacementRoutes = Router();
const appPlacementController = new AppPlacementController();

// Public — the storefront builds every page from these, so reads are open.
appPlacementRoutes.get("/", appPlacementController.getPlacements);
appPlacementRoutes.get("/:id", appPlacementController.getPlacement);

// Admin
appPlacementRoutes.use(authMiddleware, adminMiddleware);

appPlacementRoutes.post("/", upload.single("image"), appPlacementController.createPlacement);
appPlacementRoutes.post("/:id/duplicate", appPlacementController.duplicatePlacement);
appPlacementRoutes.patch("/reorder", appPlacementController.reorderPlacements);
appPlacementRoutes.put("/:id", upload.single("image"), appPlacementController.updatePlacement);
appPlacementRoutes.delete("/:id", appPlacementController.deletePlacement);
appPlacementRoutes.post("/:id/products", appPlacementController.addPlacementProducts);
appPlacementRoutes.delete("/:id/products", appPlacementController.removePlacementProducts);
appPlacementRoutes.patch("/:id/products/reorder", appPlacementController.reorderPlacementProducts);
appPlacementRoutes.post("/:id/products/reset", appPlacementController.resetPlacementProducts);
