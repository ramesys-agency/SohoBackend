export * from "./collection.controller.js";
export * from "./collection.service.js";
export * from "./collection.routes.js";

import { collectionRoutes } from "./collection.routes.js";
import { Router } from "express";

export function registerCollectionModule(): Router {
    return collectionRoutes;
}
