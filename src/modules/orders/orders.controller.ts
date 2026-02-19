import type { Request, Response, NextFunction } from "express";
import { OrderService } from "./orders.service.js";
import { BadRequestError } from "../../core/errors/http-errors.js";

export class OrderController {
    private orderService = new OrderService();

    getAllOrders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const orders = await this.orderService.getAllOrders(userId);
            res.status(200).json({
                message: "Orders fetched successfully",
                data: orders,
            });
        } catch (error) {
            next(error);
        }
    };

    getOrderById = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const orderId = req.params.orderId as string;

            if (!orderId) {
                throw new BadRequestError("Order ID is required");
            }

            const order = await this.orderService.getOrderById(userId, orderId);
            res.status(200).json({
                message: "Order fetched successfully",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };
}
