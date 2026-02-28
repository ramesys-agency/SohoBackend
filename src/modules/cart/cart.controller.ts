import type { Request, Response } from "express";
import { CartService } from "./cart.service.js";

export class CartController {
    private service: CartService;

    constructor() {
        this.service = new CartService();
    }

    addItem = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user.id;
            const { variantId } = req.query;

            if (!variantId || typeof variantId !== "string") {
                res.status(400).json({ message: "variantId is required and must be a string" });
                return;
            }

            const cartItem = await this.service.addItem(userId, variantId);
            res.json({
                message: "Item added successfully",
                data: cartItem,
            });
        } catch (error) {
            console.error("Error adding item to cart:", error);
            res.status(500).json({ message: "Failed to add item to cart" });
        }
    };

    deleteItem = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user.id;
            const { variantId } = req.query;

            if (!variantId || typeof variantId !== "string") {
                res.status(400).json({ message: "variantId is required and must be a string" });
                return;
            }

            await this.service.deleteItem(userId, variantId);
            res.json({
                message: "Item deleted successfully",
                data: null,
            });
        } catch (error) {
            console.error("Error deleting item from cart:", error);
            res.status(500).json({ message: "Failed to delete item from cart" });
        }
    };

    decrementItem = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user.id;
            const { variantId } = req.query;

            if (!variantId || typeof variantId !== "string") {
                res.status(400).json({ message: "variantId is required and must be a string" });
                return;
            }

            await this.service.decrementItem(userId, variantId);
            res.json({
                message: "Item decremented successfully",
                data: null,
            });
        } catch (error) {
            console.error("Error decrementing item from cart:", error);
            res.status(500).json({ message: "Failed to decrement item in cart" });
        }
    };

    getAllItems = async (req: Request, res: Response): Promise<void> => {
        try {
            const user = (req as any).user;
            const userId = user.id;

            const items = await this.service.getAllItems(userId);
            res.json({
                message: "Cart items fetched successfully",
                data: items,
            });
        } catch (error) {
            console.error("Error fetching cart items:", error);
            res.status(500).json({ message: "Failed to fetch cart items" });
        }
    };
}
