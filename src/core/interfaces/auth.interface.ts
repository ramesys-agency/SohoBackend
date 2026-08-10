export interface JwtPayload {
    userId: string;
    role: string;
    /**
     * Which kind of token this is. Access and refresh tokens are signed with
     * the same secret, so without this a 30-day refresh token is accepted as a
     * bearer token on every authenticated route. Optional only so tokens issued
     * before this field existed still authenticate as access tokens.
     */
    type?: "access" | "refresh";
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
