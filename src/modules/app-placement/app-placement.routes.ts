import { Router } from "express";
import { AppPlacementController } from "./app-placement.controller.js";
import { upload } from "../upload/upload.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const appPlacementRoutes = Router();
const appPlacementController = new AppPlacementController();

// Admin Routes. The storefront never calls these directly — it reads placement
// content through the collections endpoint — so the whole module is staff-only.
appPlacementRoutes.use(authMiddleware, adminMiddleware);

appPlacementRoutes.post("/", upload.single("image"), appPlacementController.createPlacement);
appPlacementRoutes.get("/:id", appPlacementController.getPlacement);
appPlacementRoutes.put("/:id", upload.single("image"), appPlacementController.updatePlacement);
appPlacementRoutes.delete("/:id", appPlacementController.deletePlacement);
appPlacementRoutes.post("/:id/products", appPlacementController.addPlacementProducts);
appPlacementRoutes.delete("/:id/products", appPlacementController.removePlacementProducts);
