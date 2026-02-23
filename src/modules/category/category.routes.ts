import { Router } from "express";
import { CategoryController } from "./category.controller.js";

export const categoryRoutes = Router();
const categoryController = new CategoryController();

categoryRoutes.get("/", categoryController.getAllCategories);
