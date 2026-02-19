import type { NextFunction, Request, Response } from "express";
import { WishlistService } from "./wishlist.service.js";

export class WishlistController {
    private wishlistService: WishlistService = new WishlistService();

    toggleWishlist = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const userId = req.user?.id;
            const { variantId } = req.query;

            if (!userId) {
                res.status(401).json({ message: "User not authenticated" });
                return;
            }

            if (!variantId || typeof variantId !== "string") {
                res.status(400).json({ message: "variantId is required and must be a string" });
                return;
            }

            const result = await this.wishlistService.toggleWishlistItem({ userId, variantId });

            if (result.action === "removed") {
                res.status(200).json({ message: "Item removed from wishlist", removed: true });
            } else {
                res.status(201).json(result.item);
            }
        } catch (error) {
            next(error);
        }
    };
}
