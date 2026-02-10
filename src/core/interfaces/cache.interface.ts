export interface CacheOptions {
    // Connection - either URL or host/port
    url?: string | undefined;
    host?: string | undefined;
    port?: number | undefined;
    password?: string | undefined;
    db?: number | undefined;
    username?: string | undefined;

    // TLS
    tls?: boolean | undefined;

    // Key prefix
    keyPrefix?: string | undefined;

    // Timeouts
    connectTimeoutMs?: number | undefined;
    commandTimeoutMs?: number | undefined;

    // Retry configuration
    retryDelayMs?: number | undefined;
    maxRetries?: number | undefined;
    maxRetriesPerRequest?: number | undefined;

    // Performance
    enableAutoPipelining?: boolean | undefined;
    enableOfflineQueue?: boolean | undefined;
}

export interface SetOptions {
    ttl?: number | undefined;
    nx?: boolean | undefined; // Only set if not exists
    xx?: boolean | undefined; // Only set if exists
}

export interface ICacheService {
    // Lifecycle
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    isConnected(): boolean;
    ping(): Promise<boolean>;

    // Basic operations
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T, options?: SetOptions): Promise<boolean>;
    del(...keys: string[]): Promise<number>;
    exists(...keys: string[]): Promise<number>;

    // Atomic operations
    getOrSet<T>(key: string, factory: () => Promise<T>, ttlSeconds?: number): Promise<T>;
    setNX<T>(key: string, value: T, ttlSeconds?: number): Promise<boolean>;
    getdel<T>(key: string): Promise<T | null>;

    // Counters
    incr(key: string): Promise<number>;
    incrBy(key: string, increment: number): Promise<number>;
    decr(key: string): Promise<number>;
    decrBy(key: string, decrement: number): Promise<number>;

    // Batch operations
    mget<T>(keys: string[]): Promise<(T | null)[]>;
    mset<T>(entries: { key: string; value: T; ttl?: number }[]): Promise<void>;

    // Key management
    scan(pattern: string, count?: number): AsyncGenerator<string[], void, unknown>;
    ttl(key: string): Promise<number>;
    expire(key: string, ttlSeconds: number): Promise<boolean>;
    persist(key: string): Promise<boolean>;

    // Dangerous operations (use with caution)
    flushDb(): Promise<void>;
}
