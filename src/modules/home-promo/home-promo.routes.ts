import { Router } from "express";
import { HomePromoController } from "./home-promo.controller.js";
import { upload } from "../upload/upload.controller.js";

export const homePromoRoutes = Router();
const controller = new HomePromoController();

homePromoRoutes.get("/", controller.getAll);
homePromoRoutes.get("/:id", controller.getById);
homePromoRoutes.post("/", upload.single("image"), controller.create);
homePromoRoutes.put("/:id", upload.single("image"), controller.update);
homePromoRoutes.delete("/:id", controller.delete);
