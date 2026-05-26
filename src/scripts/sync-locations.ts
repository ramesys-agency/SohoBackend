import "dotenv/config";
import { LocationService } from "../modules/logistics/location.service.js";
import { logger } from "../config/logger.js";
import { redis } from "../config/redis.js";

async function main() {
    const locationService = new LocationService();
    
    try {
        await redis.connect();
        logger.info("Starting manual location synchronization...");
        await locationService.syncAllLocations();
        logger.info("Location synchronization finished successfully!");
        await redis.disconnect();
        process.exit(0);
    } catch (error) {
        logger.error("Error during location synchronization", {
            error: error instanceof Error ? error.message : String(error),
        });
        await redis.disconnect();
        process.exit(1);
    }
}

main();
