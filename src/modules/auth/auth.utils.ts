import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "../../core/interfaces/index.js";

const scryptAsync = promisify(scrypt);

export interface PasswordResetPayload extends JwtPayload {
    hash: string;
}

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
        return jwt.sign({ ...payload }, secret, {
            expiresIn: "15m",
        });
    }

    static generateRefreshToken(payload: JwtPayload, secret: string): string {
        return jwt.sign({ ...payload }, secret, {
            expiresIn: "30d",
        });
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
