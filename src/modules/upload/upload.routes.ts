import { UploadController } from "./upload.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";
import { upload } from "./upload.controller.js";
import { Router } from "express";

export const uploadRoutes = Router();
const controller = new UploadController();

uploadRoutes.post("/", authMiddleware, upload.single("file"), controller.uploadFile);
