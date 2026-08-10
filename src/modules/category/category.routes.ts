import { Router } from "express";
import { CategoryController } from "./category.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const categoryRoutes = Router();
const categoryController = new CategoryController();

// Public Routes — the storefront reads these without an account.
categoryRoutes.get("/", categoryController.getAllCategories);
categoryRoutes.get("/page-title", categoryController.getPageTitle);
categoryRoutes.get("/parents", categoryController.getParentCategories);
categoryRoutes.get("/hierarchy", categoryController.getCategoryHierarchy);
categoryRoutes.get("/:id", categoryController.getCategoryById);

// Admin Routes
categoryRoutes.post("/", authMiddleware, adminMiddleware, categoryController.createCategory);
categoryRoutes.put("/:id", authMiddleware, adminMiddleware, categoryController.updateCategory);
categoryRoutes.delete("/:id", authMiddleware, adminMiddleware, categoryController.deleteCategory);
