import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../../core/errors/http-errors.js";
import { ReturnService } from "./returns.service.js";

export class ReturnController {
    private returnService = new ReturnService();

    /** The caller's own returns, newest first. */
    getMyReturns = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const returns = await this.returnService.getUserReturns(userId);
            res.status(200).json({
                message: "Returns fetched successfully",
                data: returns,
            });
        } catch (error) {
            next(error);
        }
    };

    getReturnsForOrder = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const user = (req as any).user;
            const { orderId } = req.params as { orderId: string };

            if (!orderId) {
                throw new BadRequestError("Order ID is required");
            }

            const returns = await this.returnService.getReturnsForOrder(orderId, user.id, user.role);
            res.status(200).json({
                message: "Returns fetched successfully",
                data: returns,
            });
        } catch (error) {
            next(error);
        }
    };

    adminGetAllReturns = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { status, search } = req.query as Record<string, string | undefined>;
            const returns = await this.returnService.adminGetAllReturns({
                ...(status !== undefined && { status }),
                ...(search !== undefined && { search }),
            });
            res.status(200).json({
                message: "All returns fetched successfully",
                data: returns,
            });
        } catch (error) {
            next(error);
        }
    };

    adminCreateReturns = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { orderId } = req.params as { orderId: string };

            if (!orderId) {
                throw new BadRequestError("Order ID is required");
            }

            const returns = await this.returnService.adminCreateReturns(orderId, req.body);
            res.status(201).json({
                message: "Return recorded successfully",
                data: returns,
            });
        } catch (error) {
            next(error);
        }
    };

    adminUpdateReturnStatus = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { returnId } = req.params as { returnId: string };

            if (!returnId) {
                throw new BadRequestError("Return ID is required");
            }

            const { status } = req.body ?? {};
            if (!status) {
                throw new BadRequestError("Status is required");
            }

            const updated = await this.returnService.adminUpdateReturnStatus(
                returnId,
                req.body,
                (req as any).user?.id
            );
            res.status(200).json({
                message: "Return updated successfully",
                data: updated,
            });
        } catch (error) {
            next(error);
        }
    };

    adminDeleteReturn = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { returnId } = req.params as { returnId: string };

            if (!returnId) {
                throw new BadRequestError("Return ID is required");
            }

            const result = await this.returnService.adminDeleteReturn(returnId);
            res.status(200).json({
                message: "Return deleted successfully",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };
}
