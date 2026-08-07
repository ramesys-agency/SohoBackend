import type { Request, Response, NextFunction } from "express";
import { BadRequestError } from "../../core/errors/http-errors.js";
import { CheckoutService } from "./checkout.service.js";
import { reserveCheckoutSchema } from "./checkout.schema.js";

export class CheckoutController {
    private service = new CheckoutService();

    reserve = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const parsed = reserveCheckoutSchema.safeParse(req.body ?? {});

            if (!parsed.success) {
                throw new BadRequestError(
                    parsed.error.issues[0]?.message ?? "Invalid checkout payload"
                );
            }

            const reservation = await this.service.reserve(userId, {
                buyNow: parsed.data.buyNow,
            });

            res.status(201).json({
                message: reservation.enabled
                    ? "Checkout items reserved"
                    : "Checkout started (stock reservation is disabled)",
                data: reservation,
            });
        } catch (error) {
            next(error);
        }
    };

    renew = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const checkoutId = req.params.checkoutId as string;

            const reservation = await this.service.renew(userId, checkoutId);
            res.status(200).json({
                message: "Checkout hold extended",
                data: reservation,
            });
        } catch (error) {
            next(error);
        }
    };

    status = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const checkoutId = req.params.checkoutId as string;

            const status = await this.service.status(userId, checkoutId);
            res.status(200).json({
                message: "Checkout hold fetched",
                data: status,
            });
        } catch (error) {
            next(error);
        }
    };

    release = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const checkoutId = req.params.checkoutId as string;

            const result = await this.service.release(userId, checkoutId);
            res.status(200).json({
                message: "Checkout hold released",
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };
}
