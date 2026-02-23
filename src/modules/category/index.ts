export * from "./category.controller.js";
export * from "./category.service.js";
export * from "./category.routes.js";

import { categoryRoutes } from "./category.routes.js";
import { Router } from "express";

export function registerCategoryModule(): Router {
    return categoryRoutes;
}
