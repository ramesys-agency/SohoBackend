import { Expo } from "expo-server-sdk";
import type { NotificationType, Prisma } from "@prisma/client";
import { PrismaService } from "../../core/services/index.js";
import { prisma } from "../../config/prisma.js";
import { logger } from "../../config/logger.js";
import { BadRequestError } from "../../core/errors/index.js";
import { pushJobService } from "./push-job.service.js";
import { pushJobWorker } from "./push-job.worker.js";
import type { AdminSendNotificationDto, CreateNotificationDto, RegisterPushTokenDto } from "./notification.types.js";

export class NotificationService {
    private prisma: PrismaService = prisma;

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

    // ---- Push token management ----

    async registerPushToken(userId: string, dto: RegisterPushTokenDto) {
        if (!Expo.isExpoPushToken(dto.token)) {
            throw new BadRequestError("Invalid Expo push token");
        }

        await this.prisma.getClient().pushToken.upsert({
            where: { token: dto.token },
            update: { userId, platform: dto.platform },
            create: { userId, token: dto.token, platform: dto.platform },
        });

        return { success: true };
    }

    async removePushToken(userId: string, token: string) {
        await this.prisma.getClient().pushToken.deleteMany({
            where: { userId, token },
        });
        return { success: true };
    }

    // ---- Core notification creation ----

    async createForUser(dto: CreateNotificationDto) {
        try {
            const notification = await this.prisma.getClient().$transaction(async (tx) => {
                const created = await tx.notification.create({
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

                // Queued in the same transaction as the notification row: an
                // in-app notification can never exist without its delivery job,
                // and a rolled-back notification never pushes.
                const unread = await tx.notification.count({
                    where: { userId: dto.userId, isRead: false },
                });

                await pushJobService.enqueue({
                    tx,
                    userIds: [dto.userId],
                    title: dto.title,
                    body: dto.body,
                    ...(dto.data != null ? { data: dto.data } : {}),
                    ...(dto.type ? { type: dto.type } : {}),
                    badge: unread,
                });

                return created;
            });

            // Deliver now rather than on the next poll tick. Failure here is
            // irrelevant — the job is committed and the worker will pick it up.
            pushJobWorker.kick();

            return notification;
        } catch (error) {
            logger.error("Failed to create notification", {
                userId: dto.userId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async adminSend(dto: AdminSendNotificationDto) {
        if (!dto.title?.trim()) throw new BadRequestError("Title is required");
        if (!dto.body?.trim()) throw new BadRequestError("Body is required");

        const audience = dto.audience ?? "all";

        const where: Prisma.UserWhereInput = { isDeleted: false };

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
            return {
                sent: 0,
                recipients: 0,
                push: { queued: false, devices: 0, jobs: 0, dispatchId: null },
            };
        }

        const type: NotificationType = dto.type ?? "general";
        const dataField =
            dto.data != null ? { data: dto.data as Prisma.InputJsonValue } : {};

        const result = await this.prisma.getClient().notification.createMany({
            data: recipients.map((u: { id: string }) => ({
                userId: u.id,
                title: dto.title.trim(),
                body: dto.body.trim(),
                type,
                ...dataField,
            })),
        });

        // Queue push delivery (skip if admin opted for in-app only). The admin
        // request returns as soon as the jobs are written — a broadcast to
        // thousands of devices is drained by the worker, not by this request.
        let queued = { dispatchId: "", jobs: 0, tokens: 0 };

        if (dto.pushEnabled !== false) {
            queued = await pushJobService.enqueue({
                userIds: recipients.map((u: { id: string }) => u.id),
                title: dto.title.trim(),
                body: dto.body.trim(),
                ...(dto.data != null ? { data: dto.data } : {}),
                type,
            });
            pushJobWorker.kick();
        }

        logger.info("Admin broadcast notification sent", {
            audience,
            recipients: recipients.length,
            sent: result.count,
            type,
            dispatchId: queued.dispatchId || null,
            pushJobs: queued.jobs,
            devices: queued.tokens,
        });

        return {
            sent: result.count,
            recipients: recipients.length,
            push: {
                queued: dto.pushEnabled !== false,
                devices: queued.tokens,
                jobs: queued.jobs,
                dispatchId: queued.dispatchId || null,
            },
        };
    }

    /**
     * The order's whole payment was refunded by an admin.
     *
     * Distinct from the per-return refund notice in ReturnService: this one is
     * the order-level refund, which is also what a cancelled prepaid order gets.
     */
    async notifyOrderRefunded(params: {
        userId: string;
        orderId: string;
        orderCode?: string | null;
        amount?: string | null;
    }) {
        const reference = params.orderCode || params.orderId.slice(0, 8).toUpperCase();
        const amount = params.amount ? `৳${Number(params.amount).toLocaleString()}` : null;

        return await this.createForUser({
            userId: params.userId,
            title: "Refund processed",
            body: amount
                ? `A refund of ${amount} for order #${reference} has been processed. It may take a few days to reach your account.`
                : `Your payment for order #${reference} has been refunded. It may take a few days to reach your account.`,
            type: "order",
            data: {
                orderId: params.orderId,
                orderCode: params.orderCode ?? null,
                paymentStatus: "refunded",
                screen: "orders",
            },
        });
    }

    async notifyOrderStatusChange(params: {
        userId: string;
        orderId: string;
        orderCode?: string | null;
        status: string;
        itemDetails?: string | null;
        /**
         * The admin's reason for the change. Appended to the body for the states
         * a customer will ask "why?" about — a cancellation from our side is
         * useless to them without one.
         */
        note?: string;
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
            returned: {
                title: "Order returned",
                body: `Your order #${reference} is being returned. Our team will be in touch.`,
            },
        };

        const message = messages[params.status] ?? {
            title: "Order update",
            body: `Your order #${reference} status is now "${params.status}".`,
        };

        const reason = params.note?.trim();
        const explains = params.status === "cancelled" || params.status === "returned";
        const body = explains && reason ? `${message.body} Reason: ${reason}` : message.body;

        return await this.createForUser({
            userId: params.userId,
            title: message.title,
            body,
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
