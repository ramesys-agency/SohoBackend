import { Router } from "express";
import { CollectionController } from "./collection.controller.js";

export const collectionRoutes = Router();
const collectionController = new CollectionController();

collectionRoutes.get("/", collectionController.getAllCollections);
collectionRoutes.post("/:id/products", collectionController.addProductsToCollection);
