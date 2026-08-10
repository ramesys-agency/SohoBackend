import { prisma } from "../../config/prisma.js";
import type { PrismaClient } from "@prisma/client";
import { AuthUtils } from "./auth.utils.js";
import { config } from "../../config/index.js";
import { ConflictError, UnauthorizedError, BadRequestError } from "../../core/errors/index.js";
import { MailService } from "../../core/services/index.js";
import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";
import { redis } from "../../config/redis.js";
import { logger } from "../../config/logger.js";
import crypto from "crypto";
import type {
    SignupInput,
    LoginInput,
    ForgotPasswordInput,
    ResetPasswordInput,
    GoogleAuthInput,
    AppleAuthInput,
    SendOtpInput,
    VerifyOtpInput,
} from "./auth.schema.js";

const googleClient = new OAuth2Client();

export class AuthService {
    private prisma: PrismaClient;
    private mailService = new MailService();

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

        // Verify email has successfully completed OTP verification
        const verifiedKey = `otp:verified:${email}`;
        const isVerified = await redis.get<string>(verifiedKey);
        if (!isVerified) {
            throw new BadRequestError(
                "Email is not verified. Please verify your email via OTP first."
            );
        }
        // Consume the verification token
        await redis.del(verifiedKey);

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

        if (!user || user.isDeleted || !user.passwordHash) {
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

        // Fail closed: with no configured audience there is nothing to pin the
        // token to, and any Google account from any app would be accepted.
        const audiences = config.auth.googleClientIds;
        if (!audiences.length) {
            logger.error(
                "Google sign-in attempted but no GOOGLE_CLIENT_ID is configured — rejecting"
            );
            throw new UnauthorizedError("Google sign-in is not available");
        }

        try {
            // Verifies the RS256 signature against Google's published keys and
            // checks iss/exp/aud. There is deliberately no fallback path: an
            // unverifiable token is a rejected token.
            const ticket = await googleClient.verifyIdToken({
                idToken,
                audience: audiences,
            });

            const payload = ticket.getPayload();
            if (!payload?.email || !payload.sub) {
                throw new UnauthorizedError("Invalid Google token");
            }
            if (payload.email_verified === false) {
                throw new UnauthorizedError("Google account email is not verified");
            }

            const email = payload.email;
            const providerId = payload.sub;
            const name = payload.name;
            const picture = payload.picture;

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (user?.isDeleted) {
                throw new UnauthorizedError("This account has been deleted");
            }

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
                // Existing email-password user linking Google for the first time
                user = await this.prisma.user.update({
                    where: { email },
                    data: {
                        authProvider: "google",
                        authProviderId: providerId,
                        isVerified: true,
                        // Backfill avatar from Google if the user has none
                        ...(!user.avatar && picture ? { avatar: picture } : {}),
                    },
                });
            } else if (!user.avatar && picture) {
                // Already linked Google on previous login but still has no avatar — fill it in
                user = await this.prisma.user.update({
                    where: { email },
                    data: { avatar: picture },
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
            // "This account has been deleted" and the like are decisions, not
            // verification failures — they must reach the client unchanged.
            if (error instanceof UnauthorizedError) throw error;
            logger.warn("Google Auth Error", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new UnauthorizedError("Invalid Google token");
        }
    }

    async appleAuth(input: AppleAuthInput) {
        const { identityToken, firstName, lastName } = input;

        // Same reasoning as Google: without a pinned audience, apple-signin-auth
        // accepts a correctly signed token issued to any other app.
        const audiences = config.auth.appleClientIds;
        if (!audiences.length) {
            logger.error(
                "Apple sign-in attempted but no APPLE_CLIENT_ID is configured — rejecting"
            );
            throw new UnauthorizedError("Apple sign-in is not available");
        }

        try {
            const payload = await appleSignin.verifyIdToken(identityToken, {
                audience: audiences.length === 1 ? audiences[0] : audiences,
            });

            if (!payload || !payload.email || !payload.sub) {
                throw new UnauthorizedError("Invalid Apple token");
            }

            const { email, sub: providerId } = payload;

            let user = await this.prisma.user.findUnique({
                where: { email },
            });

            if (user?.isDeleted) {
                throw new UnauthorizedError("This account has been deleted");
            }

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
            if (error instanceof UnauthorizedError) throw error;
            logger.warn("Apple Auth Error", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new UnauthorizedError("Invalid Apple token");
        }
    }

    async refreshAccessToken(refreshToken: string) {
        try {
            const payload = AuthUtils.verifyToken(refreshToken, config.auth.jwtSecret);

            // Only a token minted as a refresh token may be exchanged. Without
            // this an access token works here, and — more importantly — the
            // 30-day refresh token works as a bearer token on every other route.
            // Sessions predating the `type` claim are classified by lifetime, so
            // they keep working and pick up typed tokens from this exchange.
            if (AuthUtils.classifyToken(payload) !== "refresh") {
                throw new UnauthorizedError("Invalid refresh token");
            }

            // Verify user exists
            const user = await this.prisma.user.findUnique({
                where: { id: payload.userId },
            });

            if (!user || user.isDeleted) {
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
                isDeleted: true,
            },
        });

        if (!user || user.isDeleted || user.role !== role) {
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

        if (!user || user.isDeleted) {
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

        const resetLink = `${config.app.frontendUrl}/reset-password?token=${resetToken}`;

        // Send email with nodemailer/fallback
        await this.mailService.sendPasswordResetLink(email, resetLink, resetToken);

        // The link must never travel back over the API — anyone could then reset
        // any account by asking for it. Outside production it is returned so the
        // flow stays testable without a mailbox.
        return {
            message: "If your email is registered, you will receive a password reset link.",
            ...(config.isProduction ? {} : { resetLink }),
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

    async sendOtp(input: SendOtpInput) {
        const { email } = input;

        // Security feature 1: Rate limiting / resend cooldown check (60s)
        const cooldownKey = `otp:cooldown:${email}`;
        const hasCooldown = await redis.get(cooldownKey);
        if (hasCooldown) {
            throw new BadRequestError("Please wait 60 seconds before requesting another OTP");
        }

        const otpCode = crypto.randomInt(100000, 999999).toString();

        // Hash the OTP before storing it to protect against Redis DB exposure
        const hashedOtp = crypto.createHash("sha256").update(otpCode).digest("hex");

        // Security feature 2: Store hashed OTP in Redis with a 5-minute TTL (300 seconds)
        const otpKey = `otp:code:${email}`;
        await redis.set(otpKey, hashedOtp, { ttl: 300 });

        // Security feature 3: Set resend cooldown in Redis (60 seconds)
        await redis.set(cooldownKey, "active", { ttl: 60 });

        // Security feature 4: Reset/initialize attempt counter
        const attemptKey = `otp:attempts:${email}`;
        await redis.set(attemptKey, 0, { ttl: 300 });

        // Send actual email using Nodemailer via MailService (or fallback console-log)
        await this.mailService.sendOTP(email, otpCode);

        return {
            message: "OTP sent successfully",
            // In non-production env, return the OTP in response for testing/development convenience
            ...(!config.isProduction ? { otp: otpCode } : {}),
        };
    }

    async verifyOtp(input: VerifyOtpInput) {
        const { email, otp } = input;

        const otpKey = `otp:code:${email}`;
        const attemptKey = `otp:attempts:${email}`;

        // Get stored OTP hash
        const storedHash = await redis.get<string>(otpKey);
        if (!storedHash) {
            throw new BadRequestError(
                "OTP has expired or does not exist. Please request a new one."
            );
        }

        // Security feature 5: Increment failed attempt counter to protect against brute-force attacks
        const currentAttempts = await redis.incr(attemptKey);
        // Set TTL on attempts key to match OTP expiration time
        await redis.expire(attemptKey, 300);

        if (currentAttempts > 3) {
            // Brute force detected: invalidate OTP immediately by deleting keys
            await redis.del(otpKey, attemptKey);
            throw new BadRequestError(
                "Too many failed attempts. This OTP has been invalidated. Please request a new one."
            );
        }

        // Hash incoming OTP and compare
        const incomingHash = crypto.createHash("sha256").update(otp).digest("hex");
        if (storedHash !== incomingHash) {
            throw new BadRequestError("Invalid verification code. Please try again.");
        }

        // Security feature 6: Successful validation deletes the OTP keys immediately (One-time Use)
        await redis.del(otpKey, attemptKey);

        // Security feature 7: Store email verification status in Redis with a 15-minute TTL (900 seconds)
        const verifiedKey = `otp:verified:${email}`;
        await redis.set(verifiedKey, "true", { ttl: 900 });

        return {
            message: "OTP verified successfully",
        };
    }
}
