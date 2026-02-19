import { type Request, type Response, type NextFunction } from "express";
import { ReviewService } from "./review.service.js";
import type { AddReviewDto, UpdateReviewDto } from "./review.types.js";
import { getDummyUrl } from "../upload/upload.helper.js";

export class ReviewController {
    private reviewService = new ReviewService();

    getReviews = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { productId } = req.params;
            const { stars } = req.query;

            if (!productId) {
                res.status(400).json({ message: "ProductId is required" });
                return;
            }

            const reviews = await this.reviewService.getReviews(
                productId as string,
                stars ? Number(stars) : undefined
            );
            res.status(200).json({
                message: "Reviews fetched successfully",
                data: reviews,
            });
        } catch (error) {
            next(error);
        }
    };

    addReview = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { productId, rating, comment } = req.body;
            // Handle images and videos from req.files or req.body
            let images: string[] = req.body.images
                ? Array.isArray(req.body.images)
                    ? req.body.images
                    : [req.body.images]
                : [];
            let videos: string[] = req.body.videos
                ? Array.isArray(req.body.videos)
                    ? req.body.videos
                    : [req.body.videos]
                : [];

            if (req.files) {
                const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                if (files.images) {
                    const newImages = files.images.map(getDummyUrl).filter((url) => url !== "");
                    images = [...images, ...newImages];
                }
                if (files.videos) {
                    const newVideos = files.videos.map(getDummyUrl).filter((url) => url !== "");
                    videos = [...videos, ...newVideos];
                }
            }

            if (!productId) {
                res.status(400).json({ message: "ProductId is required" });
                return;
            }

            const data: AddReviewDto = {
                rating: Number(rating),
                comment,
                images,
                videos,
            };
            const review = await this.reviewService.addReview(userId, productId, data);
            res.status(201).json({
                message: "Review added successfully",
                data: review,
            });
        } catch (error) {
            next(error);
        }
    };

    updateReview = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { reviewId } = req.params;
            const { productId, rating, comment } = req.body;

            let images: string[] | undefined = req.body.images
                ? Array.isArray(req.body.images)
                    ? req.body.images
                    : [req.body.images]
                : undefined;
            let videos: string[] | undefined = req.body.videos
                ? Array.isArray(req.body.videos)
                    ? req.body.videos
                    : [req.body.videos]
                : undefined;

            if (req.files) {
                const files = req.files as { [fieldname: string]: Express.Multer.File[] };
                if (files.images) {
                    const newImages = files.images.map(getDummyUrl).filter((url) => url !== "");
                    images = images ? [...images, ...newImages] : newImages;
                }
                if (files.videos) {
                    const newVideos = files.videos.map(getDummyUrl).filter((url) => url !== "");
                    videos = videos ? [...videos, ...newVideos] : newVideos;
                }
            }

            if (!productId) {
                res.status(400).json({ message: "ProductId is required" });
                return;
            }

            const data: UpdateReviewDto = {
                ...(rating !== undefined && { rating: Number(rating) }),
                ...(comment !== undefined && { comment }),
                ...(images !== undefined && { images }),
                ...(videos !== undefined && { videos }),
            };
            const review = await this.reviewService.updateReview(
                userId,
                reviewId as string,
                productId,
                data
            );
            res.status(200).json({
                message: "Review updated successfully",
                data: review,
            });
        } catch (error) {
            next(error);
        }
    };

    deleteReview = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { reviewId } = req.params;
            const { productId } = req.query;

            if (!productId) {
                res.status(400).json({ message: "ProductId is required as query param" });
                return;
            }

            await this.reviewService.deleteReview(userId, reviewId as string, productId as string);
            res.status(200).json({
                message: "Review deleted successfully",
                data: null,
            });
        } catch (error) {
            next(error);
        }
    };
}
