import winston from "winston";
import LokiTransport from "winston-loki";
import { config } from "../../config/index.js";
import type { ILoggerService } from "../interfaces/index.js";

export class LoggerService implements ILoggerService {
    private logger: winston.Logger;

    constructor() {
        const transports: winston.transport[] = [
            new winston.transports.Console({
                format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.timestamp(),
                    winston.format.printf(({ level, message, timestamp, ...meta }) => {
                        const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
                        return `${timestamp} [${level}]: ${message}${metaStr}`;
                    })
                ),
            }),
        ];

        if (config.logging.lokiEnabled) {
            transports.push(
                new LokiTransport({
                    host: config.logging.lokiUrl,
                    labels: { app: config.logging.appName, env: config.env },
                    json: true,
                    replaceTimestamp: true,
                    onConnectionError: (err) => {
                        console.error("Loki connection error:", err);
                    },
                })
            );
        }

        this.logger = winston.createLogger({
            level: config.logging.level,
            format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
            transports,
        });
    }

    info(message: string, meta?: Record<string, unknown>): void {
        this.logger.info(message, meta);
    }

    warn(message: string, meta?: Record<string, unknown>): void {
        this.logger.warn(message, meta);
    }

    error(message: string, meta?: Record<string, unknown>): void {
        this.logger.error(message, meta);
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(message, meta);
    }

    http(message: string, meta?: Record<string, unknown>): void {
        this.logger.http(message, meta);
    }
}
