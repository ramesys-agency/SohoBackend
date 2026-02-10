export interface JwtPayload {
    userId: string;
    roleId: string;
    iat?: number;
    exp?: number;
}

export interface AuthUser {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    status: "ACTIVE" | "INACTIVE";
    organisationId: string;
    role: {
        id: string;
        name: string;
        status: "ACTIVE" | "INACTIVE";
    };
}

export interface IAuthService {
    verifyAndGetUser(userId: string, roleId: string): Promise<AuthUser | null>;
    invalidateUserCache(userId: string, roleId: string): Promise<void>;
}
