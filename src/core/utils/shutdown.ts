import { logger } from "../../config/logger.js";

type ShutdownTask = () => Promise<void>;

export class ShutdownManager {
    private tasks: ShutdownTask[] = [];
    private isShuttingDown = false;
    private readonly timeout: number;

    constructor(timeoutMs = 30000) {
        this.timeout = timeoutMs;
    }

    register(task: ShutdownTask): void {
        this.tasks.push(task);
    }

    listen(): void {
        const handler = (signal: string) => this.execute(signal);
        process.on("SIGTERM", () => handler("SIGTERM"));
        process.on("SIGINT", () => handler("SIGINT"));
    }

    private async execute(signal: string): Promise<void> {
        if (this.isShuttingDown) {
            logger.info("Shutdown already in progress...");
            return;
        }
        this.isShuttingDown = true;
        logger.info(`Received ${signal}, shutting down gracefully...`);

        const timer = setTimeout(() => {
            logger.error("Shutdown timed out, forcing exit");
            process.exit(1);
        }, this.timeout);

        try {
            for (const task of this.tasks) {
                await task();
            }
            clearTimeout(timer);
            logger.info("Shutdown completed");
            process.exit(0);
        } catch (error) {
            clearTimeout(timer);
            logger.error(`Shutdown error: ${error}`);
            process.exit(1);
        }
    }
}
