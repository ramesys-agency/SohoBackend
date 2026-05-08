import { Prisma } from "@prisma/client";
import { PrismaService } from "../../core/services/index.js";
import type { AddReviewDto, UpdateReviewDto } from "./review.types.js";
import { prisma } from "../../config/prisma.js";


export class ReviewService {
    private prisma: PrismaService;

    constructor() {
        this.prisma = prisma;
    }

    async getReviews(productId: string, stars?: number) {
        // Verify product exists
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
        });

        if (!product) {
            throw new Error("Product not found");
        }

        const where: any = { productId };
        if (stars) {
            where.rating = stars;
        }

        const reviews = await this.prisma.getClient().review.findMany({
            where,
            include: {
                user: {
                    select: {
                        id: true,
                        fullName: true,
                    },
                },
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return reviews;
    }

    async addReview(userId: string, productId: string, data: AddReviewDto) {
        // Verify product exists
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
        });

        if (!product) {
            throw new Error("Product not found");
        }

        try {
            const review = await this.prisma.getClient().review.create({
                data: {
                    userId,
                    productId,
                    rating: data.rating,
                    ...(data.comment !== undefined && { comment: data.comment }),
                    ...(data.images !== undefined && { images: data.images }),
                    ...(data.videos !== undefined && { videos: data.videos }),
                },
            });

            // Update product stats
            await this.updateProductStats(productId);

            return review;
        } catch (error: any) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
                throw new Error("You have already reviewed this product.");
            }
            throw error;
        }
    }

    async updateReview(userId: string, reviewId: string, productId: string, data: UpdateReviewDto) {
        // Verify product exists
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
        });

        if (!product) {
            throw new Error("Product not found");
        }

        const review = await this.prisma.getClient().review.findUnique({
            where: { id: reviewId },
        });

        if (!review) {
            throw new Error("Review not found");
        }

        if (review.userId !== userId) {
            throw new Error("Not authorized to update this review");
        }

        if (review.productId !== productId) {
            throw new Error("Review does not belong to the specified product");
        }

        const updatedReview = await this.prisma.getClient().review.update({
            where: { id: reviewId },
            data: {
                ...(data.rating !== undefined && { rating: data.rating }),
                ...(data.comment !== undefined && { comment: data.comment }),
                ...(data.images !== undefined && { images: data.images }),
                ...(data.videos !== undefined && { videos: data.videos }),
            },
        });

        // Update product stats
        if (data.rating !== undefined) {
            await this.updateProductStats(review.productId);
        }

        return updatedReview;
    }

    async deleteReview(userId: string, reviewId: string, productId: string) {
        // Verify product exists
        const product = await this.prisma.getClient().product.findUnique({
            where: { id: productId },
        });

        if (!product) {
            throw new Error("Product not found");
        }

        const review = await this.prisma.getClient().review.findUnique({
            where: { id: reviewId },
        });

        if (!review) {
            throw new Error("Review not found");
        }

        if (review.userId !== userId) {
            throw new Error("Not authorized to delete this review");
        }

        if (review.productId !== productId) {
            throw new Error("Review does not belong to the specified product");
        }

        await this.prisma.getClient().review.delete({
            where: { id: reviewId },
        });

        await this.updateProductStats(review.productId);

        return { success: true };
    }

    private async updateProductStats(productId: string) {
        const reviews = await this.prisma.getClient().review.findMany({
            where: { productId },
            select: { rating: true },
        });

        const totalReviews = reviews.length;
        const averageRating =
            totalReviews > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / totalReviews : 0;

        await this.prisma.getClient().product.update({
            where: { id: productId },
            data: {
                reviewCount: totalReviews,
                overallRating: averageRating,
            },
        });
    }
}
