import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "../../config/index.js";
import type { IPrismaService } from "../interfaces/index.js";
import { logger } from "../../config/logger.js";

export class PrismaService implements IPrismaService {
    private client: PrismaClient;
    private pool: pg.Pool;
    private connected: boolean = false;

    constructor() {
        this.pool = new pg.Pool({
            connectionString: config.database.url,
            min: config.database.pool.min,
            max: config.database.pool.max,
            idleTimeoutMillis: config.database.pool.idleTimeoutMillis,
            connectionTimeoutMillis: config.database.pool.connectionTimeoutMillis,
        });

        this.pool.on("error", (err) => {
            logger.error("Unexpected error on idle database client", { error: String(err) });
            this.connected = false;

            // Attempt to verify and recover connection after a delay
            setTimeout(async () => {
                try {
                    const recovered = await this.checkConnection();
                    if (recovered) {
                        logger.info("Database connection recovered successfully");
                    } else {
                        logger.warn(
                            "Database connection recovery failed, will retry on next request"
                        );
                    }
                } catch (error) {
                    logger.error("Database connection recovery check failed", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
            }, 5000); // Wait 5 seconds before attempting recovery
        });

        this.pool.on("connect", () => {
            logger.debug("New database connection established in pool");
        });

        this.pool.on("remove", () => {
            logger.debug("Database connection removed from pool");
        });

        const adapter = new PrismaPg(this.pool);
        this.client = new PrismaClient({ adapter });
    }

    async connect(): Promise<void> {
        await this.client.$connect();

        // Verify actual database connectivity
        try {
            await this.client.$queryRaw`SELECT 1`;
            this.connected = true;
        } catch (error) {
            this.connected = false;
            await this.client.$disconnect();
            throw new Error(`Database connection verification failed: ${error}`);
        }
    }

    async disconnect(): Promise<void> {
        await this.client.$disconnect();
        await this.pool.end();
        this.connected = false;
    }

    getClient(): PrismaClient {
        return this.client;
    }

    async isConnected(): Promise<boolean> {
        return this.checkConnection();
    }

    async checkConnection(): Promise<boolean> {
        try {
            await this.client.$queryRaw`SELECT 1`;
            this.connected = true;
            return true;
        } catch {
            this.connected = false;
            return false;
        }
    }
}
