import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../../core/errors/http-errors.js";
import { OrderService } from "./orders.service.js";
import { orderStatusPoller } from "./orders.poller.js";
import { logisticsJobWorker } from "../logistics/logistics-job.worker.js";
import { reservationSweeper } from "../checkout/reservation.sweeper.js";

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
            const user = (req as any).user;
            const orderId = req.params.orderId as string;

            if (!orderId) {
                throw new BadRequestError("Order ID is required");
            }

            const order = await this.orderService.getOrderById(user.id, orderId, user.role);
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
            const { search, startDate, endDate, paymentStatus, fulfillmentStatus, orderType } =
                req.query as Record<string, string | undefined>;
            const orders = await this.orderService.adminGetAllOrders({
                ...(search !== undefined && { search }),
                ...(startDate !== undefined && { startDate }),
                ...(endDate !== undefined && { endDate }),
                ...(paymentStatus !== undefined && { paymentStatus }),
                ...(fulfillmentStatus !== undefined && { fulfillmentStatus }),
                ...(orderType !== undefined && { orderType }),
            });
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

    adminGetManualOrders = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { handled, search } = req.query as Record<string, string | undefined>;
            const orders = await this.orderService.adminGetManualOrders({
                ...(handled !== undefined && { handled }),
                ...(search !== undefined && { search }),
            });

            res.status(200).json({
                message: "Manual shipping orders fetched successfully",
                data: orders,
            });
        } catch (error) {
            next(error);
        }
    };

    adminGetManualCount = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const count = await this.orderService.adminGetManualCount();
            res.status(200).json({
                message: "Manual shipping count fetched successfully",
                data: count,
            });
        } catch (error) {
            next(error);
        }
    };

    adminSetManualHandled = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params;
            if (!orderId || typeof orderId !== "string") {
                throw new BadRequestError("Valid Order ID is required");
            }

            // The route decides the direction; the body is not trusted for it.
            const handled = !req.path.endsWith("/unhandled");
            const adminId = (req as any).user.id;

            const order = await this.orderService.adminSetManualHandled(orderId, adminId, handled);
            res.status(200).json({
                message: handled
                    ? "Order marked as handled"
                    : "Order moved back to the manual shipping queue",
                data: order,
            });
        } catch (error) {
            next(error);
        }
    };

    adminRetrySync = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params;
            if (!orderId || typeof orderId !== "string") {
                throw new BadRequestError("Valid Order ID is required");
            }

            const result = await this.orderService.adminRetrySync(orderId);
            res.status(200).json({
                message: result.order?.orderCode
                    ? "Order synced with RoadRush successfully"
                    : "Retry attempted — the order is still queued",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Drain the logistics retry queue once. The in-process worker does this on
     * an interval; this endpoint lets an external cron drive it instead.
     */
    runLogisticsJobs = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await logisticsJobWorker.runOnce();
            res.status(200).json({
                message: result.skipped
                    ? "Sweep skipped — another run is already in progress"
                    : "Logistics jobs processed",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };

    /** Expire lapsed checkout holds. Same cron-friendly rationale as above. */
    sweepReservations = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await reservationSweeper.runOnce();
            res.status(200).json({
                message: result.skipped
                    ? "Sweep skipped — another run is already in progress"
                    : "Expired checkout holds swept",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Sweep all in-flight orders for status changes.
     * The in-process poller does this on an interval; this endpoint exists so an
     * external cron can drive it on hosts that suspend idle processes.
     */
    pollOrderStatuses = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const result = await orderStatusPoller.runOnce();
            res.status(200).json({
                message: result.skipped
                    ? "Poll skipped — another run is already in progress"
                    : "Order statuses polled successfully",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };
}
