import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../../core/errors/http-errors.js";
import { OrderService } from "./orders.service.js";

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

    createOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const data = req.body;

            const order = await this.orderService.createOrder(userId, data);
            res.status(201).json({
                message: "Order placed successfully",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };

    adminGetAllOrders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const orders = await this.orderService.adminGetAllOrders();
            res.status(200).json({
                message: "All orders fetched successfully",
                data: orders,
            });
        } catch (error) {
            next(error);
        }
    };

    updateOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params;
            const { status, note } = req.body;

            if (!orderId || typeof orderId !== "string") {
                throw new BadRequestError("Valid Order ID is required");
            }

            const order = await this.orderService.updateOrderStatus(orderId, status, note);

            res.status(200).json({
                message: "Order status updated successfully",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };

    adminUpdatePaymentStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params as { orderId: string };
            const { status } = req.body;

            if (!orderId) {
                throw new BadRequestError("Order ID is required");
            }

            const payment = await this.orderService.adminUpdatePaymentStatus(orderId, status);

            res.status(200).json({
                message: "Payment status updated successfully",
                data: payment,
            });
        } catch (error) {
            next(error);
        }
    };

    syncOrderWithRoadRush = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params;
            if (!orderId || typeof orderId !== "string") {
                throw new BadRequestError("Valid Order ID is required");
            }

            const order = await this.orderService.syncOrderWithRoadRush(orderId);
            res.status(200).json({
                message: "Order synced with RoadRush successfully",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };

    refreshOrderStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params;
            if (!orderId || typeof orderId !== "string") {
                throw new BadRequestError("Valid Order ID is required");
            }

            const order = await this.orderService.refreshOrderStatus(orderId);
            res.status(200).json({
                message: "Order status refreshed successfully",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };
}
