import { Router } from "express";
import { CollectionController } from "./collection.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const collectionRoutes = Router();
const collectionController = new CollectionController();

// Public Route — the storefront reads collections (including banner and
// placement filters) without an account.
collectionRoutes.get("/", collectionController.getAllCollections);

// Admin Routes
collectionRoutes.post(
    "/:id/products",
    authMiddleware,
    adminMiddleware,
    collectionController.addProductsToCollection
);
collectionRoutes.delete(
    "/:id/products",
    authMiddleware,
    adminMiddleware,
    collectionController.removeProductsFromCollection
);
collectionRoutes.put(
    "/:id",
    authMiddleware,
    adminMiddleware,
    collectionController.updateCollection
);
collectionRoutes.delete(
    "/:id",
    authMiddleware,
    adminMiddleware,
    collectionController.deleteCollection
);
