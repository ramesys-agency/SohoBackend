import { type Response, type NextFunction, type Request } from "express";
import { CouponService } from "./coupon.service.js";
import { BadRequestError } from "../../core/errors/http-errors.js";

export class CouponController {
    private couponService = new CouponService();

    createCoupon = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const coupon = await this.couponService.createCoupon(req.body);
            res.status(201).json({ success: true, data: coupon });
        } catch (error) {
            next(error);
        }
    };

    getAllCoupons = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const coupons = await this.couponService.getAllCoupons();
            res.status(200).json({ success: true, data: coupons });
        } catch (error) {
            next(error);
        }
    };

    getCouponById = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params as { id: string };
            if (!id) throw new BadRequestError("ID is required");
            const coupon = await this.couponService.getCouponById(id);
            res.status(200).json({ success: true, data: coupon });
        } catch (error) {
            next(error);
        }
    };

    updateCoupon = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params as { id: string };
            if (!id) throw new BadRequestError("ID is required");
            const coupon = await this.couponService.updateCoupon(id, req.body);
            res.status(200).json({ success: true, data: coupon });
        } catch (error) {
            next(error);
        }
    };

    deleteCoupon = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params as { id: string };
            if (!id) throw new BadRequestError("ID is required");
            await this.couponService.deleteCoupon(id);
            res.status(200).json({ success: true, message: "Coupon deleted successfully" });
        } catch (error) {
            next(error);
        }
    };
 
    expireCoupon = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { id } = req.params as { id: string };
            if (!id) throw new BadRequestError("ID is required");
            const coupon = await this.couponService.expireCoupon(id);
            res.status(200).json({ success: true, data: coupon });
        } catch (error) {
            next(error);
        }
    };

    validateCoupon = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { code, cartItems } = req.body;
            const userId = (req as any).user.id;
            const result = await this.couponService.validateCoupon(code, userId, cartItems);
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    };
}
