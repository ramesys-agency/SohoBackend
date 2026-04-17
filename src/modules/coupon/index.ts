import { createCouponRouter } from "./coupon.routes.js";

export function registerCouponModule() {
    return createCouponRouter();
}

export * from "./coupon.service.js";
export * from "./coupon.controller.js";
