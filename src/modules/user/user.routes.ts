import { Router } from "express";
import { UserController } from "./user.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";
import { upload } from "../upload/upload.controller.js";

export class UserRoutes {
    static get routes(): Router {
        const router = Router();

        const controller = new UserController();

        router.put("/profile", authMiddleware, controller.updateProfile);
        router.patch("/avatar", authMiddleware, upload.single("avatar"), controller.updateAvatar);
        router.get("/profile", authMiddleware, controller.getProfile);
        router.delete("/account", authMiddleware, controller.deleteAccount);
        // Staff-only: both return other people's contact details.
        router.get("/admin/all", authMiddleware, adminMiddleware, controller.getAllUsers);
        router.post("/admin/create", authMiddleware, adminMiddleware, controller.createAdmin);
        router.get("/:id", authMiddleware, adminMiddleware, controller.getUserById);

        return router;
    }
}
