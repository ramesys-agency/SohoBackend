import express, { type Application } from "express";
import type { Server } from "http";
import os from "os";
import {
    createRequestLoggerMiddleware,
    ErrorHandler,
    setupMiddleware,
    type MiddlewareConfig,
} from "./core/middleware/index.js";
import { createRouter } from "./routes/index.js";
import { logger } from "./config/logger.js";

export interface AppConfig extends MiddlewareConfig {
    port: number;
}

export class App {
    private readonly app: Application;
    private readonly config: AppConfig;
    private server: Server | null = null;

    constructor(config: AppConfig) {
        this.app = express();
        this.app.set("trust proxy", 1);
        this.config = config;

        setupMiddleware(this.app, {
            customMiddlewares: [createRequestLoggerMiddleware()],
        });
        this.app.use(createRouter());
        this.app.use(new ErrorHandler().middleware());
    }

    start(): Server {
        this.server = this.app.listen(this.config.port, "0.0.0.0", () => {
            const interfaces = os.networkInterfaces();
            const addresses: string[] = [];

            Object.keys(interfaces).forEach((interfaceName) => {
                interfaces[interfaceName]?.forEach((iface: os.NetworkInterfaceInfo) => {
                    if (iface.family === "IPv4" && !iface.internal) {
                        addresses.push(iface.address);
                    }
                });
            });

            logger.info("Server started successfully");
            logger.info(`- Local:   http://localhost:${this.config.port}`);
            addresses.forEach((address) => {
                logger.info(`- Network: http://${address}:${this.config.port}`);
            });
        });

        // Configure timeouts to prevent resource exhaustion
        this.server.setTimeout(30000); // 30 seconds request timeout
        this.server.keepAliveTimeout = 65000; // Slightly higher than typical load balancer timeout
        this.server.headersTimeout = 66000; // Slightly higher than keepAliveTimeout

        return this.server;
    }

    async shutdown(): Promise<void> {
        if (!this.server?.listening) return;

        return new Promise((resolve) => {
            this.server!.close(() => {
                logger.info("HTTP server closed");
                resolve();
            });
        });
    }

    getExpressApp(): Application {
        return this.app;
    }

    getServer(): Server | null {
        return this.server;
    }
}
