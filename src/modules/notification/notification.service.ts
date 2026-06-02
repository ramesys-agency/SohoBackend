import type { NotificationType, Prisma } from "@prisma/client";
import { PrismaService } from "../../core/services/index.js";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { BadRequestError } from "../../core/errors/index.js";
import type { AdminSendNotificationDto, CreateNotificationDto } from "./notification.types.js";

export class NotificationService {
    private prisma: PrismaService = prisma;

    /**
     * Fetch notifications for a single user, newest first.
     * `filter` controls whether to return all, only-read or only-unread items.
     */
    async getUserNotifications(
        userId: string,
        filter: "all" | "read" | "unread" = "all",
        limit = 50
    ) {
        const where: Prisma.NotificationWhereInput = { userId };
        if (filter === "read") where.isRead = true;
        if (filter === "unread") where.isRead = false;

        return await this.prisma.getClient().notification.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
        });
    }

    async getUnreadCount(userId: string) {
        return await this.prisma.getClient().notification.count({
            where: { userId, isRead: false },
        });
    }

    async markAsRead(userId: string, notificationId: string) {
        // Scope the update to the owner so users can't touch others' notifications.
        const result = await this.prisma.getClient().notification.updateMany({
            where: { id: notificationId, userId },
            data: { isRead: true, readAt: new Date() },
        });

        if (result.count === 0) {
            throw new BadRequestError("Notification not found");
        }

        return { success: true };
    }

    async markAllAsRead(userId: string) {
        const result = await this.prisma.getClient().notification.updateMany({
            where: { userId, isRead: false },
            data: { isRead: true, readAt: new Date() },
        });
        return { success: true, updated: result.count };
    }

    /**
     * Core helper: create a notification for a single user. Used by other
     * modules (e.g. orders) to notify a user about something. Never throws to
     * the caller — notification failures must not break the parent operation.
     */
    async createForUser(dto: CreateNotificationDto) {
        try {
            return await this.prisma.getClient().notification.create({
                data: {
                    userId: dto.userId,
                    title: dto.title,
                    body: dto.body,
                    type: dto.type ?? "general",
                    ...(dto.data != null
                        ? { data: dto.data as Prisma.InputJsonValue }
                        : {}),
                },
            });
        } catch (error) {
            logger.error("Failed to create notification", {
                userId: dto.userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    /**
     * Admin broadcast: resolve target users from the supplied filters and
     * create one notification row per recipient (so each can be marked read
     * individually and surfaced in that user's in-app inbox).
     */
    async adminSend(dto: AdminSendNotificationDto) {
        if (!dto.title?.trim()) throw new BadRequestError("Title is required");
        if (!dto.body?.trim()) throw new BadRequestError("Body is required");

        const audience = dto.audience ?? "all";

        const where: Prisma.UserWhereInput = { isDeleted: false };

        // By default only target customers; admins opt-in explicitly.
        if (!dto.includeAdmins) {
            where.role = "customer";
        }

        if (audience === "region") {
            const regions = (dto.regions ?? []).filter((r) => r && r.trim());
            if (regions.length === 0) {
                throw new BadRequestError("At least one region is required for region audience");
            }
            where.region = { in: regions, mode: "insensitive" };
        } else if (audience === "users") {
            const userIds = (dto.userIds ?? []).filter(Boolean);
            if (userIds.length === 0) {
                throw new BadRequestError("At least one user is required for users audience");
            }
            where.id = { in: userIds };
        }

        const recipients = await this.prisma.getClient().user.findMany({
            where,
            select: { id: true },
        });

        if (recipients.length === 0) {
            return { sent: 0, recipients: 0 };
        }

        const type: NotificationType = dto.type ?? "general";
        const dataField =
            dto.data != null ? { data: dto.data as Prisma.InputJsonValue } : {};

        const result = await this.prisma.getClient().notification.createMany({
            data: recipients.map((u) => ({
                userId: u.id,
                title: dto.title.trim(),
                body: dto.body.trim(),
                type,
                ...dataField,
            })),
        });

        logger.info("Admin broadcast notification sent", {
            audience,
            recipients: recipients.length,
            sent: result.count,
            type,
        });

        return { sent: result.count, recipients: recipients.length };
    }

    /**
     * Domain helper used by the order module to notify a customer that their
     * order status changed.
     */
    async notifyOrderStatusChange(params: {
        userId: string;
        orderId: string;
        orderCode?: string | null;
        status: string;
        itemDetails?: string | null;
    }) {
        const reference = params.orderCode || params.orderId.slice(0, 8).toUpperCase();
        const messages: Record<string, { title: string; body: string }> = {
            pending: {
                title: "Order received",
                body: `We've received your order #${reference} and it's being reviewed.`,
            },
            processing: {
                title: "Order is being processed",
                body: `Good news! Your order #${reference} is now being processed.`,
            },
            shipped: {
                title: "Order shipped",
                body: `Your order #${reference} is on its way to you.`,
            },
            delivered: {
                title: "Order delivered",
                body: `Your order #${reference} has been delivered. Enjoy!`,
            },
            cancelled: {
                title: "Order cancelled",
                body: `Your order #${reference} has been cancelled.`,
            },
        };

        const message = messages[params.status] ?? {
            title: "Order update",
            body: `Your order #${reference} status is now "${params.status}".`,
        };

        return await this.createForUser({
            userId: params.userId,
            title: message.title,
            body: message.body,
            type: "order",
            data: {
                orderId: params.orderId,
                orderCode: params.orderCode ?? null,
                status: params.status,
                screen: "orders",
            },
        });
    }
}
