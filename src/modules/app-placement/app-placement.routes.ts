import { Router } from "express";
import { AppPlacementController } from "./app-placement.controller.js";
import { upload } from "../upload/upload.controller.js";

export const appPlacementRoutes = Router();
const appPlacementController = new AppPlacementController();

// Admin Routes
appPlacementRoutes.post("/", upload.single("image"), appPlacementController.createPlacement);
appPlacementRoutes.put("/:id", upload.single("image"), appPlacementController.updatePlacement);
appPlacementRoutes.delete("/:id", appPlacementController.deletePlacement);
