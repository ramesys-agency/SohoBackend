import type { IAuthService, AuthUser } from "../interfaces/index.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../config/redis.js";
import { config } from "../../config/index.js";
import { prisma } from "../../config/prisma.js";

export interface AuthServiceConfig {
    cacheTtl: number;
}

export class AuthService implements IAuthService {
    private cacheFailureCount = 0;
    private readonly MAX_CACHE_FAILURES = 10;
    private cacheFailureResetTimer: NodeJS.Timeout | null = null;

    async verifyAndGetUser(userId: string, roleId: string): Promise<AuthUser | null> {
        const cacheKey = `auth:${userId}:${roleId}`;

        // Circuit breaker: skip cache if failure threshold exceeded
        // Circuit breaker: skip cache if failure threshold exceeded
        if (redis.isConnected() && this.cacheFailureCount < this.MAX_CACHE_FAILURES) {
            try {
                return await redis.getOrSet<AuthUser | null>(
                    cacheKey,
                    () => this.fetchUserFromDb(userId, roleId),
                    config.auth.cacheTtl
                );
            } catch (error) {
                this.cacheFailureCount++;
                logger.warn("Cache operation failed, falling back to DB", {
                    error: error instanceof Error ? error.message : String(error),
                    userId,
                    roleId,
                    failureCount: this.cacheFailureCount,
                });

                // If threshold reached, log critical warning and start reset timer
                if (this.cacheFailureCount >= this.MAX_CACHE_FAILURES) {
                    logger.error("Cache failure threshold reached, temporarily disabling cache", {
                        threshold: this.MAX_CACHE_FAILURES,
                    });
                    this.startCacheFailureResetTimer();
                }
                // Fall through to direct DB query
            }
        }
        // Direct DB query (cache unavailable or failed)
        return this.fetchUserFromDb(userId, roleId);
    }

    private startCacheFailureResetTimer(): void {
        // Clear existing timer if any
        if (this.cacheFailureResetTimer) {
            clearTimeout(this.cacheFailureResetTimer);
        }

        // Reset failure count after 5 minutes to allow cache recovery
        this.cacheFailureResetTimer = setTimeout(() => {
            logger.info("Resetting cache failure count, re-enabling cache", {
                previousCount: this.cacheFailureCount,
            });
            this.cacheFailureCount = 0;
            this.cacheFailureResetTimer = null;
        }, 300000); // 5 minutes
    }

    async invalidateUserCache(userId: string, roleId: string): Promise<void> {
        if (!redis.isConnected()) {
            return;
        }

        const cacheKey = `auth:${userId}:${roleId}`;
        try {
            await redis.del(cacheKey);
            logger.debug("Auth cache invalidated", { userId, roleId });
        } catch (error) {
            logger.warn("Failed to invalidate auth cache", {
                error: error instanceof Error ? error.message : String(error),
                userId,
                roleId,
            });
        }
    }

    private async fetchUserFromDb(userId: string, role: string): Promise<AuthUser | null> {
        const db = prisma.getClient();
        const user = await db.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                role: true,
            },
        });

        if (!user) {
            return null;
        }

        // Verify role matches
        if (user.role !== role) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
        };
    }
}
