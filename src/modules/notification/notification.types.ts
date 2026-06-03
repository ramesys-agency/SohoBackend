import type { NotificationType } from "@prisma/client";

export interface CreateNotificationDto {
    userId: string;
    title: string;
    body: string;
    type?: NotificationType;
    data?: Record<string, unknown> | null;
}

export interface RegisterPushTokenDto {
    token: string;
    platform: "ios" | "android";
}

/**
 * Filters the admin can use to target a broadcast.
 * - audience "all": every customer
 * - audience "region": every customer in the given region(s)
 * - audience "users": only the explicitly listed userIds
 */
export interface AdminSendNotificationDto {
    title: string;
    body: string;
    type?: NotificationType;
    data?: Record<string, unknown> | null;

    audience?: "all" | "region" | "users";
    regions?: string[];
    userIds?: string[];

    // When true, admins are also included. Defaults to false (customers only).
    includeAdmins?: boolean;

    // When false, only in-app notifications are created (no mobile push). Defaults to true.
    pushEnabled?: boolean;
}
