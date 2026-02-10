import type { PrismaClient } from "../../generated/prisma/client.js";

export interface IPrismaService {
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    getClient(): PrismaClient;
    isConnected(): Promise<boolean>;
    checkConnection(): Promise<boolean>;
}
