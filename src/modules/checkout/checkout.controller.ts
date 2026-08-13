import type { Request, Response, NextFunction } from "express";
import { config } from "../../config/index.js";
import { prisma } from "../../config/prisma.js";
import { BadRequestError, NotFoundError } from "../../core/errors/http-errors.js";
import { CheckoutService } from "./checkout.service.js";
import { reserveCheckoutSchema } from "./checkout.schema.js";
import {
    DELIVERY_REGION_LABELS,
    getDeliveryFee,
    resolveDeliveryFee,
    type DeliveryRegion,
} from "./delivery-fee.js";

export class CheckoutController {
    private service = new CheckoutService();

    /**
     * Checkout pricing the client needs before an order exists. The delivery fee
     * is applied server-side on every order; this is only so the app can show
     * the same breakdown the server will charge.
     *
     * Both regional rates are returned because the app has to quote a fee on the
     * product page, before any address is chosen. `deliveryFee` stays as the
     * single-number default for older builds, and is the higher of the two so an
     * app that ignores the region never quotes under what it will charge.
     */
    getConfig = (_req: Request, res: Response, next: NextFunction) => {
        try {
            res.status(200).json({
                message: "Checkout config fetched",
                data: {
                    deliveryFee: Math.max(
                        config.checkout.deliveryFees.INSIDE_DHAKA,
                        config.checkout.deliveryFees.OUTSIDE_DHAKA
                    ),
                    deliveryFees: config.checkout.deliveryFees,
                    deliveryRegions: (
                        Object.keys(DELIVERY_REGION_LABELS) as DeliveryRegion[]
                    ).map((region) => ({
                        region,
                        label: DELIVERY_REGION_LABELS[region],
                        fee: getDeliveryFee(region),
                    })),
                    currency: "BDT",
                },
            });
        } catch (error) {
            next(error);
        }
    };

    /**
     * The fee for one saved address, resolved by the same code order creation
     * uses. The app calls this once the customer has picked where the parcel is
     * going, so the total on the payment screen is the total that gets charged
     * instead of a region the client guessed at.
     */
    getAddressDeliveryFee = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = (req as any).user.id;
            const addressId = req.query.addressId;

            if (typeof addressId !== "string" || addressId.trim() === "") {
                throw new BadRequestError("addressId is required");
            }

            // Scoped to the caller: an unscoped lookup would let anyone who
            // guesses an address id probe whose district it sits in.
            const address = await prisma.getClient().address.findFirst({
                where: { id: addressId, userId, isDeleted: false },
                select: { district: true, city: true },
            });
            if (!address) {
                throw new NotFoundError("Drop address not found");
            }

            const resolved = resolveDeliveryFee(address);
            res.status(200).json({
                message: "Delivery fee fetched",
                data: { ...resolved, currency: "BDT" },
            });
        } catch (error) {
            next(error);
        }
    };

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
