import { Router } from "express";
import { NotificationController } from "./notification.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

export const notificationRoutes = Router();
const controller = new NotificationController();

// Authenticated user routes
notificationRoutes.get("/", authMiddleware, controller.getMyNotifications);
notificationRoutes.get("/unread-count", authMiddleware, controller.getUnreadCount);
notificationRoutes.patch("/read-all", authMiddleware, controller.markAllAsRead);
notificationRoutes.patch("/:id/read", authMiddleware, controller.markAsRead);

// Push token routes
notificationRoutes.post("/push-token", authMiddleware, controller.registerPushToken);
notificationRoutes.delete("/push-token", authMiddleware, controller.removePushToken);

// Admin routes
notificationRoutes.post("/admin/send", authMiddleware, adminMiddleware, controller.adminSend);

// Admin: push delivery queue
notificationRoutes.get("/admin/push/stats", authMiddleware, adminMiddleware, controller.pushStats);
notificationRoutes.post("/admin/push/drain", authMiddleware, adminMiddleware, controller.pushDrain);
notificationRoutes.post("/admin/push/test", authMiddleware, adminMiddleware, controller.pushTest);
