import { Redis, type RedisOptions } from "ioredis";
import type { ICacheService, CacheOptions, SetOptions } from "../interfaces/index.js";
import { logger } from "../../config/logger.js";

/**
 * Production-ready Redis cache service using ioredis.
 *
 * Features:
 * - Connection URL or host/port configuration
 * - TLS support for cloud deployments
 * - Automatic reconnection with exponential backoff
 * - Auto-pipelining for better performance
 * - SCAN-based iteration (non-blocking)
 * - Atomic operations (setNX, getOrSet, getdel)
 * - Counter operations (incr, decr)
 * - Proper error handling and logging
 *
 * @see https://github.com/redis/ioredis
 */
export class CacheService implements ICacheService {
    private client: Redis | null = null;
    private connected: boolean = false;
    private readonly options: CacheOptions;

    constructor(options: CacheOptions) {
        this.options = options;
    }

    async connect(): Promise<void> {
        const {
            url,
            host = "localhost",
            port = 6379,
            password,
            username,
            db = 0,
            tls,
            keyPrefix,
            connectTimeoutMs = 10000,
            commandTimeoutMs = 5000,
            retryDelayMs = 100,
            maxRetries = 10,
            maxRetriesPerRequest = 3,
            enableAutoPipelining = true,
            enableOfflineQueue = true,
        } = this.options;

        // Build Redis options
        const redisOptions: RedisOptions = {
            // Timeouts
            connectTimeout: connectTimeoutMs,
            commandTimeout: commandTimeoutMs,

            // Retry strategy with exponential backoff (capped at 30s)
            retryStrategy: (times: number) => {
                if (times > maxRetries) {
                    logger.error("Redis max connection retries exceeded", { times, maxRetries });
                    return null;
                }
                // True exponential backoff: retryDelayMs * 2^(times-1)
                const delay = Math.min(retryDelayMs * Math.pow(2, times - 1), 30000);
                logger.warn("Redis reconnecting", { attempt: times, delayMs: delay });
                return delay;
            },

            // Performance and reliability
            maxRetriesPerRequest,
            enableAutoPipelining,
            enableOfflineQueue,
            enableReadyCheck: true,
            autoResubscribe: true,
            autoResendUnfulfilledCommands: true,
            lazyConnect: true,

            // Don't buffer commands indefinitely
            maxLoadingRetryTime: 30000,
        };

        // Connection: URL takes precedence over host/port
        if (url) {
            // Warn if other connection options are also set (they will be ignored)
            if (keyPrefix || password || username || db !== 0 || tls) {
                logger.warn(
                    "Redis URL provided; keyPrefix, password, username, db, and tls options are ignored. Include them in the URL instead."
                );
            }
            // ioredis accepts URL in constructor
            this.client = new Redis(url, redisOptions);
        } else {
            // Host/port configuration
            const hostPortOptions: RedisOptions = {
                ...redisOptions,
                host,
                port,
                db,
            };

            if (password) {
                hostPortOptions.password = password;
            }

            if (username) {
                hostPortOptions.username = username;
            }

            if (keyPrefix) {
                hostPortOptions.keyPrefix = `${keyPrefix}:`;
            }

            if (tls) {
                hostPortOptions.tls = {};
            }

            this.client = new Redis(hostPortOptions);
        }

        // Event handlers
        this.client.on("connect", () => {
            logger.info("Redis TCP connection established");
        });

        this.client.on("ready", () => {
            this.connected = true;
            logger.info("Redis ready to accept commands");
        });

        this.client.on("error", (err: Error) => {
            logger.error("Redis error", { error: err.message, stack: err.stack });
            // Don't set connected = false here, let close/end events handle it
        });

        this.client.on("close", () => {
            this.connected = false;
            logger.warn("Redis connection closed, will attempt reconnection");
        });

        this.client.on("reconnecting", (delay: number) => {
            logger.info("Redis reconnecting", { delayMs: delay });
            // connected will be set to true by 'ready' event after successful reconnection
        });

        this.client.on("end", () => {
            this.connected = false;
            logger.info("Redis connection ended permanently");
        });

        // Connect
        await this.client.connect();
        this.connected = true;
    }

    async disconnect(): Promise<void> {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            this.connected = false;
            logger.info("Redis disconnected gracefully");
        }
    }

    isConnected(): boolean {
        return this.connected && this.client !== null && this.client.status === "ready";
    }

    async ping(): Promise<boolean> {
        if (!this.client) {
            return false;
        }
        try {
            const result = await this.client.ping();
            return result === "PONG";
        } catch {
            return false;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Basic Operations
    // ─────────────────────────────────────────────────────────────────────────────

    async get<T>(key: string): Promise<T | null> {
        this.ensureConnected();
        const value = await this.client!.get(key);
        if (value === null) {
            return null;
        }
        return this.deserialize<T>(value);
    }

    async set<T>(key: string, value: T, options?: SetOptions): Promise<boolean> {
        this.ensureConnected();
        const serialized = this.serialize(value);

        let result: string | null;

        // Use modern SET with options instead of deprecated SETEX
        if (options?.ttl !== undefined && options?.nx) {
            result = await this.client!.set(key, serialized, "EX", options.ttl, "NX");
        } else if (options?.ttl !== undefined && options?.xx) {
            result = await this.client!.set(key, serialized, "EX", options.ttl, "XX");
        } else if (options?.ttl !== undefined) {
            result = await this.client!.set(key, serialized, "EX", options.ttl);
        } else if (options?.nx) {
            result = await this.client!.set(key, serialized, "NX");
        } else if (options?.xx) {
            result = await this.client!.set(key, serialized, "XX");
        } else {
            result = await this.client!.set(key, serialized);
        }

        return result === "OK";
    }

    async del(...keys: string[]): Promise<number> {
        this.ensureConnected();
        if (keys.length === 0) {
            return 0;
        }
        return this.client!.del(...keys);
    }

    async exists(...keys: string[]): Promise<number> {
        this.ensureConnected();
        if (keys.length === 0) {
            return 0;
        }
        return this.client!.exists(...keys);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Cache-Aside & Conditional Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Get value from cache, or compute and store it if not present.
     * This is the cache-aside pattern.
     *
     * NOTE: This is not atomic - concurrent calls during cache miss may invoke
     * factory() multiple times. For truly atomic operations, use setNX with
     * a distributed lock pattern.
     *
     * IMPORTANT: Cannot distinguish between a cached null value and a cache miss.
     * If factory() returns null, it will be cached but subsequent calls will
     * re-invoke factory() since get() returns null for both cases. Avoid caching
     * null values with this method.
     */
    async getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T> {
        this.ensureConnected();

        // Try to get existing value
        const existing = await this.get<T>(key);
        if (existing !== null) {
            return existing;
        }

        // Compute new value
        const value = await factory();

        // Store it
        await this.set(key, value, ttlSeconds ? { ttl: ttlSeconds } : undefined);

        return value;
    }

    /**
     * Set value only if key does not exist (useful for distributed locks).
     */
    async setNX<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean> {
        return this.set(key, value, { nx: true, ttl: ttlSeconds });
    }

    /**
     * Get value and delete key atomically.
     */
    async getdel<T>(key: string): Promise<T | null> {
        this.ensureConnected();
        const value = await this.client!.getdel(key);
        if (value === null) {
            return null;
        }
        return this.deserialize<T>(value);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Counter Operations
    // ─────────────────────────────────────────────────────────────────────────────

    async incr(key: string): Promise<number> {
        this.ensureConnected();
        return this.client!.incr(key);
    }

    async incrBy(key: string, increment: number): Promise<number> {
        this.ensureConnected();
        return this.client!.incrby(key, increment);
    }

    async decr(key: string): Promise<number> {
        this.ensureConnected();
        return this.client!.decr(key);
    }

    async decrBy(key: string, decrement: number): Promise<number> {
        this.ensureConnected();
        return this.client!.decrby(key, decrement);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Batch Operations
    // ─────────────────────────────────────────────────────────────────────────────

    async mget<T>(keys: string[]): Promise<(T | null)[]> {
        this.ensureConnected();
        if (keys.length === 0) {
            return [];
        }
        const values = await this.client!.mget(...keys);
        return values.map((v: string | null) => (v === null ? null : this.deserialize<T>(v)));
    }

    async mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void> {
        this.ensureConnected();
        if (entries.length === 0) {
            return;
        }

        // Use pipeline for batched network-efficient operations (not atomic)
        const pipeline = this.client!.pipeline();
        for (const { key, value, ttl } of entries) {
            const serialized = this.serialize(value);
            if (ttl !== undefined) {
                // Use modern SET with EX instead of deprecated SETEX
                pipeline.set(key, serialized, "EX", ttl);
            } else {
                pipeline.set(key, serialized);
            }
        }

        const results = await pipeline.exec();
        if (results) {
            const errors = results
                .map(([err], index) =>
                    err ? { key: entries[index]?.key, error: String(err) } : null
                )
                .filter((e): e is { key: string | undefined; error: string } => e !== null);

            if (errors.length > 0) {
                logger.error("mset pipeline partial failure", { errors });
                throw new Error(`mset failed for ${errors.length} key(s)`);
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Key Management
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Iterate over keys matching pattern using SCAN (non-blocking).
     * IMPORTANT: Use this instead of KEYS command in production.
     *
     * @example
     * for await (const keys of cache.scan('user:*')) {
     *   console.log(keys);
     * }
     */
    async *scan(pattern: string, count = 100): AsyncGenerator<string[], void, unknown> {
        this.ensureConnected();

        let cursor = "0";
        do {
            const [nextCursor, keys] = await this.client!.scan(
                cursor,
                "MATCH",
                pattern,
                "COUNT",
                count
            );
            cursor = nextCursor;
            if (keys.length > 0) {
                yield keys;
            }
        } while (cursor !== "0");
    }

    async ttl(key: string): Promise<number> {
        this.ensureConnected();
        return this.client!.ttl(key);
    }

    async expire(key: string, ttlSeconds: number): Promise<boolean> {
        this.ensureConnected();
        const result = await this.client!.expire(key, ttlSeconds);
        return result === 1;
    }

    async persist(key: string): Promise<boolean> {
        this.ensureConnected();
        const result = await this.client!.persist(key);
        return result === 1;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Dangerous Operations
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Delete all keys in the current database.
     * WARNING: This is destructive and should be used with caution.
     */
    async flushDb(): Promise<void> {
        this.ensureConnected();
        logger.warn("Flushing Redis database");
        await this.client!.flushdb();
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // Private Helpers
    // ─────────────────────────────────────────────────────────────────────────────

    private ensureConnected(): void {
        if (!this.client || !this.connected) {
            throw new Error("Redis client is not connected");
        }
    }

    private serialize<T>(value: T): string {
        try {
            return JSON.stringify(value);
        } catch (error) {
            logger.error("Failed to serialize cache value", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw new Error("Cache serialization failed: value may contain circular references");
        }
    }

    private deserialize<T>(value: string): T | null {
        try {
            return JSON.parse(value) as T;
        } catch (error) {
            // Don't log raw value to avoid sensitive data exposure
            logger.error("Failed to deserialize cache value", {
                error: error instanceof Error ? error.message : String(error),
                valueLength: value.length,
            });
            return null;
        }
    }
}
