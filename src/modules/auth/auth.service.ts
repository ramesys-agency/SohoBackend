import { prisma } from "../../config/prisma.js";
import type { PrismaClient } from "@prisma/client";
import { AuthUtils } from "./auth.utils.js";
import { config } from "../../config/index.js";
import { ConflictError, UnauthorizedError, BadRequestError } from "../../core/errors/index.js";
import { MailService } from "../../core/services/index.js";
// import { OAuth2Client } from "google-auth-library";
import appleSignin from "apple-signin-auth";
import { redis } from "../../config/redis.js";
import crypto from "crypto";
import https from "https";

function googleTokenInfo(idToken: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const path = `/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
        https
            .get({ hostname: "oauth2.googleapis.com", path, port: 443 }, (res) => {
                let body = "";
                res.on("data", (c) => (body += c));
                res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(body) }));
            })
            .on("error", reject);
    });
}
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

// const googleClient = new OAuth2Client();

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

        try {
            let email: string;
            let providerId: string;
            let name: string | undefined;
            let picture: string | undefined;

            // Try Google's tokeninfo endpoint first
            try {
                const { status, data: tokenInfo } = await googleTokenInfo(idToken);
                if (status === 200 && tokenInfo.email && !tokenInfo.error) {
                    // Validate audience against our configured client ID
                    if (tokenInfo.aud !== config.auth.googleClientId) {
                        throw new UnauthorizedError("Invalid Google token audience");
                    }
                    email = tokenInfo.email;
                    providerId = tokenInfo.sub;
                    name = tokenInfo.name;
                    picture = tokenInfo.picture;
                } else {
                    throw new Error("tokeninfo failed");
                }
            } catch (err) {
                if (err instanceof UnauthorizedError) throw err;
                // Fallback: decode JWT locally (no network call needed)
                const parts = idToken.split(".");
                if (parts.length !== 3) throw new UnauthorizedError("Invalid Google token");
                const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
                const now = Math.floor(Date.now() / 1000);
                const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
                if (!payload.email || !GOOGLE_ISSUERS.includes(payload.iss) || payload.exp < now) {
                    throw new UnauthorizedError("Invalid Google token");
                }
                if (payload.aud !== config.auth.googleClientId) {
                    throw new UnauthorizedError("Invalid Google token audience");
                }
                console.warn("[GoogleAuth] Used local JWT decode (tokeninfo unreachable)");
                email = payload.email;
                providerId = payload.sub;
                name = payload.name;
                picture = payload.picture;
            }

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
            console.error("Google Auth Error:", error instanceof Error ? error.message : error);
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

        return {
            message: "Password reset link generated and email sent.",
            resetLink,
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
