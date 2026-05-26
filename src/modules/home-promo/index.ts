import { Router } from "express";
import { homePromoRoutes } from "./home-promo.routes.js";

export function registerHomePromoModule(): Router {
    return homePromoRoutes;
}
