import { LocationService } from "../modules/logistics/location.service.js";
import { logger } from "../config/logger.js";

async function main() {
    const locationService = new LocationService();
    
    try {
        logger.info("Starting manual location synchronization...");
        await locationService.syncAllLocations();
        logger.info("Location synchronization finished successfully!");
        process.exit(0);
    } catch (error) {
        logger.error("Error during location synchronization", {
            error: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
}

main();
