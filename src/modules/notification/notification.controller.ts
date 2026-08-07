import { type Request, type Response, type NextFunction } from "express";
import { NotificationService } from "./notification.service.js";
import { pushJobService } from "./push-job.service.js";
import { pushJobWorker } from "./push-job.worker.js";
import type { AdminSendNotificationDto, RegisterPushTokenDto } from "./notification.types.js";

export class NotificationController {
    private notificationService = new NotificationService();

    getMyNotifications = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }

            const filterParam = (req.query.filter as string) || "all";
            const filter =
                filterParam === "read" || filterParam === "unread" ? filterParam : "all";

            const notifications = await this.notificationService.getUserNotifications(
                userId,
                filter
            );
            res.status(200).json({
                message: "Notifications fetched successfully",
                data: notifications,
            });
        } catch (error) {
            next(error);
        }
    };

    getUnreadCount = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const count = await this.notificationService.getUnreadCount(userId);
            res.status(200).json({
                message: "Unread count fetched successfully",
                data: { count },
            });
        } catch (error) {
            next(error);
        }
    };

    markAsRead = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { id } = req.params;
            await this.notificationService.markAsRead(userId, id as string);
            res.status(200).json({ message: "Notification marked as read", data: null });
        } catch (error) {
            next(error);
        }
    };

    markAllAsRead = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const result = await this.notificationService.markAllAsRead(userId);
            res.status(200).json({ message: "All notifications marked as read", data: result });
        } catch (error) {
            next(error);
        }
    };

    // ---- Push token ----

    registerPushToken = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { token, platform } = req.body as RegisterPushTokenDto;
            if (!token || !platform) {
                res.status(400).json({ message: "token and platform are required" });
                return;
            }
            const result = await this.notificationService.registerPushToken(userId, { token, platform });
            res.status(200).json({ message: "Push token registered", data: result });
        } catch (error) {
            next(error);
        }
    };

    removePushToken = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                res.status(401).json({ message: "Unauthorized" });
                return;
            }
            const { token } = req.body as { token: string };
            if (!token) {
                res.status(400).json({ message: "token is required" });
                return;
            }
            const result = await this.notificationService.removePushToken(userId, token);
            res.status(200).json({ message: "Push token removed", data: result });
        } catch (error) {
            next(error);
        }
    };

    // ---- Admin ----

    adminSend = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { title, body, type, data, audience, regions, userIds, includeAdmins } =
                req.body as AdminSendNotificationDto;

            const dto: AdminSendNotificationDto = { title, body };
            if (type !== undefined) dto.type = type;
            if (data !== undefined) dto.data = data;
            if (audience !== undefined) dto.audience = audience;
            if (regions !== undefined) dto.regions = regions;
            if (userIds !== undefined) dto.userIds = userIds;
            if (includeAdmins !== undefined) dto.includeAdmins = includeAdmins;

            const result = await this.notificationService.adminSend(dto);

            res.status(201).json({
                message: `Notification sent to ${result.sent} user(s)`,
                data: result,
            });
        } catch (error) {
            next(error);
        }
    };

    // ---- Admin: push queue ----

    /** Queue depth, 24h delivery outcome and device counts per platform. */
    pushStats = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const data = await pushJobService.getStats();
            res.status(200).json({ message: "Push queue stats fetched successfully", data });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Drain the queue now. Lets an external cron drive delivery on hosts that
     * suspend idle processes, and gives support a way to flush a backlog.
     */
    pushDrain = async (_req: Request, res: Response, next: NextFunction) => {
        try {
            const data = await pushJobWorker.runOnce();
            res.status(200).json({ message: "Push queue drained", data });
        } catch (error) {
            next(error);
        }
    };

    /**
     * Send a test push immediately and report Expo's verdict per device, so
     * iOS and Android delivery can be proven separately.
     */
    pushTest = async (req: Request, res: Response, next: NextFunction) => {
        try {
            const { userId, title, body } = req.body as {
                userId?: string;
                title?: string;
                body?: string;
            };

            // Defaults to the admin's own devices, which is the common case when
            // checking that a build's credentials work.
            const target = userId || req.user?.id;
            if (!target) {
                res.status(400).json({ message: "userId is required" });
                return;
            }

            const data = await pushJobService.sendTestNow(target, title, body);

            res.status(200).json({
                message: data.devices
                    ? `Test push sent to ${data.devices} device(s)`
                    : "This user has no registered devices",
                data,
            });
        } catch (error) {
            next(error);
        }
    };
}
