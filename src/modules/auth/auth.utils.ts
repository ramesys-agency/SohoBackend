import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../../core/interfaces/index.js";

const scryptAsync = promisify(scrypt);

export interface PasswordResetPayload extends JwtPayload {
    hash: string;
}

const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL = "30d";

/**
 * Anything living longer than this is a refresh token. Access tokens are minted
 * for 15 minutes, refresh tokens for 30 days, so the gap is enormous and the
 * threshold never has to be precise.
 */
const LEGACY_REFRESH_MIN_LIFETIME_SECONDS = 60 * 60;

export class AuthUtils {
    static async hashPassword(password: string): Promise<string> {
        const salt = randomBytes(16).toString("hex");
        const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
        return `${salt}:${derivedKey.toString("hex")}`;
    }

    static async verifyPassword(password: string, hash: string): Promise<boolean> {
        const [salt, key] = hash.split(":");
        if (!salt || !key) return false;
        const keyBuffer = Buffer.from(key, "hex");
        const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
        return timingSafeEqual(keyBuffer, derivedKey);
    }

    static generateAccessToken(payload: JwtPayload, secret: string): string {
        return jwt.sign({ ...payload, type: "access" }, secret, {
            expiresIn: ACCESS_TOKEN_TTL,
        });
    }

    static generateRefreshToken(payload: JwtPayload, secret: string): string {
        return jwt.sign({ ...payload, type: "refresh" }, secret, {
            expiresIn: REFRESH_TOKEN_TTL,
        });
    }

    /**
     * What kind of token this is.
     *
     * Tokens minted before the `type` claim existed carry no marker, and both
     * kinds are signed with the same secret — so they are told apart by how long
     * they were issued for. That keeps sessions created before this change alive
     * (they upgrade to typed tokens on their next refresh) without letting a
     * legacy 30-day refresh token pass as a bearer token in the meantime.
     */
    static classifyToken(payload: JwtPayload): "access" | "refresh" {
        if (payload.type) return payload.type;

        const lifetime =
            payload.exp !== undefined && payload.iat !== undefined
                ? payload.exp - payload.iat
                : 0;

        return lifetime > LEGACY_REFRESH_MIN_LIFETIME_SECONDS ? "refresh" : "access";
    }

    static verifyToken(token: string, secret: string): JwtPayload {
        return jwt.verify(token, secret) as JwtPayload;
    }

    static generatePasswordResetToken(payload: PasswordResetPayload, secret: string): string {
        return jwt.sign({ ...payload }, secret, {
            expiresIn: "15m", // Short expiration for security
        });
    }

    static verifyPasswordResetToken(token: string, secret: string): PasswordResetPayload {
        return jwt.verify(token, secret) as PasswordResetPayload;
    }
}
