export * from "./app-placement.controller.js";
export * from "./app-placement.routes.js";
export * from "./app-placement.service.js";

import { appPlacementRoutes } from "./app-placement.routes.js";
import { Router } from "express";

export function registerAppPlacementModule(): Router {
    return appPlacementRoutes;
}

