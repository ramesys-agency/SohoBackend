export interface JwtPayload {
    userId: string;
    role: string;
    iat?: number;
    exp?: number;
}

export interface AuthUser {
    id: string;
    email: string;
    fullName: string;
    phone: string | null;
    role: string; // Storing role as string (enum value)
}

export interface IAuthService {
    verifyAndGetUser(userId: string, role: string): Promise<AuthUser | null>;
    invalidateUserCache(userId: string, role: string): Promise<void>;
}
