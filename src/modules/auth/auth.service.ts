import { prisma } from "../../config/prisma.js";
import type { PrismaClient } from "@prisma/client";
import { AuthUtils } from "./auth.utils.js";
import { config } from "../../config/index.js";
import { ConflictError, UnauthorizedError, BadRequestError } from "../../core/errors/index.js";
import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";
import type {
    SignupInput,
    LoginInput,
    ForgotPasswordInput,
    ResetPasswordInput,
    GoogleAuthInput,
    AppleAuthInput,
} from "./auth.schema.js";

const googleClient = new OAuth2Client();

export class AuthService {
    private prisma: PrismaClient;

    constructor() {
        // We can inject PrismaService or instantiate it.
        // In this project, it seems services instantiate it or it's singleton.
        // PrismaService in core exports a class.
        // Let's create a new instance or usage pattern.
        // Looking at core/services/auth.service.ts, it takes prisma in constructor.
        // But here in module, we might want to dependency injection or just instantiate.
        // `src/app.ts` instantiates services? No, it uses `setupMiddleware`.
        // Let's look at `src/modules/health/health.service.ts` if it exists.
        // Assuming we instantiate PrismaService explicitly for now.

        // Since PrismaService connects on demand or we rely on the global pool?
        // actually PrismaService creates a new client.
        // Ideally we should share the client.
        // But for now, let's just use it as is, or better, import a singleton if available.
        // `src/config/index.js` ??
        this.prisma = prisma.getClient();
    }

    // Better approach: Pass prisma client in constructor if possible, but for module simplicity:
    // We will stick to `new PrismaService().getClient()` but verify if we need to connect.
    // Actually, `PrismaService` has `connect()` method.
    // If we create a new instance, we might need to connect.
    // However, usually we want a singleton PrismaService.
    // Let's assume for now we can getting it working.
    // A better pattern would be to export a singleton instance of PrismaService from core.
    // But `core/services/prisma.service.ts` exports the class.

    async signup(input: SignupInput) {
        const { email, password, fullName, phone } = input;

        const existingUser = await this.prisma.user.findUnique({
            where: { email },
        });

        if (existingUser) {
            throw new ConflictError("User with this email already exists");
        }

        const passwordHash = await AuthUtils.hashPassword(password);

        const user = await this.prisma.user.create({
            data: {
                email,
                passwordHash,
                fullName,
                phone: phone ?? null,
                role: "customer", // Default role
            },
        });

        const accessToken = AuthUtils.generateAccessToken(
            { userId: user.id, role: user.role },
            config.auth.jwtSecret
        );

        const refreshToken = AuthUtils.generateRefreshToken(
            { userId: user.id, role: user.role },
            config.auth.jwtSecret
        );

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                avatar: user.avatar,
            },
            accessToken,
            refreshToken,
        };
    }

    async login(input: LoginInput) {
        const { email, password } = input;

        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user || !user.passwordHash) {
            throw new UnauthorizedError("Invalid email or password");
        }

        const isValid = await AuthUtils.verifyPassword(password, user.passwordHash);

        if (!isValid) {
            throw new UnauthorizedError("Invalid email or password");
        }

        const accessToken = AuthUtils.generateAccessToken(
            { userId: user.id, role: user.role },
            config.auth.jwtSecret
        );

        const refreshToken = AuthUtils.generateRefreshToken(
            { userId: user.id, role: user.role },
            config.auth.jwtSecret
        );

        return {
            user: {
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                role: user.role,
                avatar: user.avatar,
            },
            accessToken,
            refreshToken,
        };
    }

    async googleAuth(input: GoogleAuthInput) {
        const { idToken } = input;

        try {
            // Verify the token with the audience if configured.
            const verifyOptions: any = { idToken };
            if (config.auth.googleClientId) {
                verifyOptions.audience = config.auth.googleClientId;
            }

            const ticket = await googleClient.verifyIdToken(verifyOptions);
            const payload = ticket.getPayload();

            if (!payload || !payload.email) {
                throw new UnauthorizedError("Invalid Google token");
            }

            const { email, sub: providerId, name, picture } = payload;

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                // User doesn't exist, create a new one
                user = await this.prisma.user.create({
                    data: {
                        email,
                        fullName: name || "Google User",
                        avatar: picture ?? null,
                        authProvider: "google",
                        authProviderId: providerId,
                        role: "customer",
                        isVerified: true, // Google emails are verified
                    },
                });
            } else if (!user.authProviderId) {
                // User exists but hasn't linked Google yet, link it
                user = await this.prisma.user.update({
                    where: { email },
                    data: {
                        authProvider: "google",
                        authProviderId: providerId,
                        isVerified: true,
                    },
                });
            }

            const accessToken = AuthUtils.generateAccessToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            const refreshToken = AuthUtils.generateRefreshToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            return {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    role: user.role,
                    avatar: user.avatar,
                },
                accessToken,
                refreshToken,
            };
        } catch (error) {
            console.error("Google Auth Error:", error);
            throw new UnauthorizedError("Invalid Google token");
        }
    }

    async appleAuth(input: AppleAuthInput) {
        const { identityToken, firstName, lastName } = input;

        try {
            const verifyOptions: any = {};
            if (config.auth.appleClientId) {
                verifyOptions.audience = config.auth.appleClientId;
            }

            const payload = await appleSignin.verifyIdToken(identityToken, verifyOptions);

            if (!payload || !payload.email || !payload.sub) {
                throw new UnauthorizedError("Invalid Apple token");
            }

            const { email, sub: providerId } = payload;

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (!user) {
                // Determine full name
                let fullName = "Apple User";
                if (firstName && lastName) {
                    fullName = `${firstName} ${lastName}`;
                } else if (firstName) {
                    fullName = firstName;
                } else if (lastName) {
                    fullName = lastName;
                }

                user = await this.prisma.user.create({
                    data: {
                        email,
                        fullName,
                        authProvider: "apple",
                        authProviderId: providerId,
                        role: "customer",
                        isVerified: true, // Apple emails are verified
                    },
                });
            } else if (!user.authProviderId) {
                // User exists but hasn't linked Apple yet, link it
                user = await this.prisma.user.update({
                    where: { email },
                    data: {
                        authProvider: "apple",
                        authProviderId: providerId,
                        isVerified: true,
                    },
                });
            }

            const accessToken = AuthUtils.generateAccessToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            const refreshToken = AuthUtils.generateRefreshToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            return {
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    role: user.role,
                    avatar: user.avatar,
                },
                accessToken,
                refreshToken,
            };
        } catch (error) {
            console.error("Apple Auth Error:", error);
            throw new UnauthorizedError("Invalid Apple token");
        }
    }

    async refreshAccessToken(refreshToken: string) {
        try {
            const payload = AuthUtils.verifyToken(refreshToken, config.auth.jwtSecret);

            // Verify user exists
            const user = await this.prisma.user.findUnique({
                where: { id: payload.userId },
            });

            if (!user) {
                throw new UnauthorizedError("User not found");
            }

            // Verify role matches
            if (user.role !== payload.role) {
                throw new UnauthorizedError("Invalid role");
            }

            const newAccessToken = AuthUtils.generateAccessToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            const newRefreshToken = AuthUtils.generateRefreshToken(
                { userId: user.id, role: user.role },
                config.auth.jwtSecret
            );

            return {
                accessToken: newAccessToken,
                refreshToken: newRefreshToken,
            };
        } catch {
            throw new UnauthorizedError("Invalid or expired refresh token");
        }
    }

    async verifyAndGetUser(userId: string, role: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                fullName: true,
                phone: true,
                role: true,
                avatar: true,
            },
        });

        if (!user || user.role !== role) {
            return null;
        }

        return {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            phone: user.phone,
            role: user.role,
            avatar: user.avatar,
        };
    }

    async invalidateUserCache(_userId: string): Promise<void> {
        // No-op for now as this service doesn't use caching yet
        return Promise.resolve();
    }

    async forgotPassword(input: ForgotPasswordInput) {
        const { email } = input;

        const user = await this.prisma.user.findUnique({
            where: { email },
        });

        if (!user) {
            // Security: Don't reveal if user exists.
            // But for now, returning success even if user not found is best practice.
            // OR throwing specific error if internal policy allows.
            // Following standard practice: return success.
            return {
                message: "If your email is registered, you will receive a password reset link.",
            };
        }

        // Create a secret based on user's password hash?
        // Actually, we use the method 1 below.

        // This ensures that if password changes, the token becomes invalid.

        // We can just use the global secret + user specific data to make it single use?
        // Actually, to make it single use (invalidated after use), we MUST include the current password hash (or part of it)
        // in the token payload OR signature verification.
        // METHOD 1: Payload = { userId, hash: currentPasswordHash }. Verify: check if payload.hash === current.hash.
        // METHOD 2: Sign with secret + currentPasswordHash. Verify with same.

        // Let's use Method 1 as it's cleaner with our AuthUtils.

        const payload = {
            userId: user.id,
            role: user.role,
            hash: user.passwordHash || "social_user",
        };

        const resetToken = AuthUtils.generatePasswordResetToken(payload, config.auth.jwtSecret);

        // TODO: Send email
        // For now, return the link as requested.
        // Assuming frontend URL is in config or hardcoded for now.
        const resetLink = `${config.app.frontendUrl}/reset-password?token=${resetToken}`;

        return {
            message: "Password reset link generated.",
            resetLink, // TODO: Remove this when email service is integrated
        };
    }

    async resetPassword(input: ResetPasswordInput) {
        const { token, password } = input;

        try {
            const payload = AuthUtils.verifyPasswordResetToken(token, config.auth.jwtSecret);

            const user = await this.prisma.user.findUnique({
                where: { id: payload.userId },
            });

            if (!user) {
                throw new UnauthorizedError("Invalid token");
            }

            // Check if tax hash matches current user hash
            // This ensures single-use: once we change password, hash changes, old token invalid.
            if (payload.hash !== (user.passwordHash || "social_user")) {
                throw new UnauthorizedError("Invalid or expired token");
            }

            const newPasswordHash = await AuthUtils.hashPassword(password);

            await this.prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: newPasswordHash },
            });

            return { message: "Password reset successful" };
        } catch (error) {
            if (error instanceof UnauthorizedError) throw error;
            throw new BadRequestError("Invalid or expired token");
        }
    }
}
