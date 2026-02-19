import { Router } from "express";
import { AddressController } from "./address.controller.js";
import { authMiddleware } from "../../core/middleware/auth.middleware.js";

export class AddressRoutes {
    static get routes(): Router {
        const router = Router();
        const controller = new AddressController();

        router.get("/", authMiddleware, controller.getAddresses);
        router.get("/:id", authMiddleware, controller.getAddressById);
        router.post("/", authMiddleware, controller.createAddress);
        router.put("/:id", authMiddleware, controller.updateAddress);
        router.patch("/:id/default", authMiddleware, controller.setDefault);
        router.delete("/:id", authMiddleware, controller.deleteAddress);

        return router;
    }
}
