import { Router } from "express";
import { CategoryController } from "./category.controller.js";

export const categoryRoutes = Router();
const categoryController = new CategoryController();

categoryRoutes.get("/", categoryController.getAllCategories);
categoryRoutes.get("/page-title", categoryController.getPageTitle);

// Admin Routes
categoryRoutes.post("/", categoryController.createCategory);
categoryRoutes.put("/:id", categoryController.updateCategory);
categoryRoutes.delete("/:id", categoryController.deleteCategory);
categoryRoutes.get("/parents", categoryController.getParentCategories);
categoryRoutes.get("/hierarchy", categoryController.getCategoryHierarchy);
