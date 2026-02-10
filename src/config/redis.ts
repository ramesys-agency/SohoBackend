import { CacheService } from "../core/services/cache.service.js";
import { config } from "./index.js";

// Initialize cache service with config
// Note: Actual connection happens in server.ts via connect()
export const redis = new CacheService({
    url: config.redis.url,
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    username: config.redis.username,
    db: config.redis.db,
    tls: config.redis.tls,
    keyPrefix: config.redis.keyPrefix,
    // Add defaults or other config mappings if needed,
    // CacheService constructor logic handles defaults effectively.
});
