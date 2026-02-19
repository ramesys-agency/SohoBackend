import { Router } from "express";
import { ReviewController } from "./review.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";
import { upload } from "../upload/upload.controller.js";

export const reviewRoutes = Router();
const controller = new ReviewController();

const uploadFields = upload.fields([
    { name: "images", maxCount: 5 },
    { name: "videos", maxCount: 2 },
]);

reviewRoutes.get("/:productId", controller.getReviews);
reviewRoutes.post("/", authMiddleware, uploadFields, controller.addReview);
reviewRoutes.put("/:reviewId", authMiddleware, uploadFields, controller.updateReview);
reviewRoutes.delete("/:reviewId", authMiddleware, controller.deleteReview);
