import { Router } from "express";
import { HomePromoController } from "./home-promo.controller.js";
import { upload } from "../upload/upload.controller.js";

export const homePromoRoutes = Router();
const controller = new HomePromoController();

homePromoRoutes.get("/", controller.getSection);
homePromoRoutes.put("/", upload.single("image"), controller.updateSection);
