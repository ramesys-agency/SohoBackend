import type { PrismaClient } from "@prisma/client";

export interface IPrismaService {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getClient(): PrismaClient;
    isConnected(): Promise<boolean>;
    checkConnection(): Promise<boolean>;
}
