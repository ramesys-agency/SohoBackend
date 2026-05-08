import { PrismaService } from "../../core/services/index.js";
import { RoadRushService } from "./roadrush.service.js";
import { logger } from "../../config/logger.js";
import { prisma } from "../../config/prisma.js";


/**
 * Location Service for managing local hierarchical location data
 */
export class LocationService {
    private prisma: PrismaService = prisma;
    private roadRush: RoadRushService = new RoadRushService();

    // --- Local DB Getters ---

    async getDivisions() {
        return this.prisma.getClient().division.findMany({
            orderBy: { name: "asc" },
        });
    }

    async getDistricts(divisionId: string) {
        return this.prisma.getClient().district.findMany({
            where: { divisionId },
            orderBy: { name: "asc" },
        });
    }

    async getThanas(districtId: string) {
        return this.prisma.getClient().thana.findMany({
            where: { districtId },
            orderBy: { name: "asc" },
        });
    }

    async getAreas(thanaId: string) {
        return this.prisma.getClient().area.findMany({
            where: { thanaId },
            orderBy: { name: "asc" },
        });
    }

    // --- Synchronization from RoadRush ---

    /**
     * Sycnchronize all locations from RoadRush API into local database.
     * Caution: This can be a heavy operation as it traverses the entire hierarchy.
     */
    async syncAllLocations() {
        logger.info("Starting logistics location synchronization");

        try {
            const divisionsResponse = await this.roadRush.getDivisions();

            const totalDivisions = divisionsResponse.data.length;
            logger.info(`Found ${totalDivisions} divisions to sync`);

            for (let i = 0; i < totalDivisions; i++) {
                const div = divisionsResponse.data[i];
                logger.info(`[${i + 1}/${totalDivisions}] Syncing Division: ${div.name}...`);

                const dbDiv = await this.prisma.getClient().division.upsert({
                    where: { externalId: div.id },
                    update: { name: div.name },
                    create: { name: div.name, externalId: div.id },
                });

                // Fetch and Sync Districts
                const districtsResponse = await this.roadRush.getDistricts(div.id);
                for (const dist of districtsResponse.data) {
                    const dbDist = await this.prisma.getClient().district.upsert({
                        where: { externalId: dist.id },
                        update: {
                            name: dist.name,
                            pathaoId: dist.pathao_id?.toString(),
                        },
                        create: {
                            name: dist.name,
                            externalId: dist.id,
                            divisionId: dbDiv.id,
                            pathaoId: dist.pathao_id?.toString(),
                        },
                    });

                    // Fetch and Sync Thanas
                    const thanasResponse = await this.roadRush.getThanas(dist.id);
                    for (const thana of thanasResponse.data) {
                        const dbThana = await this.prisma.getClient().thana.upsert({
                            where: { externalId: thana.id },
                            update: {
                                name: thana.name,
                                pathaoId: thana.pathao_id?.toString(),
                                rdxId: thana.rdx_id?.toString(),
                                zipCode: thana.zip_code?.toString(),
                            },
                            create: {
                                name: thana.name,
                                externalId: thana.id,
                                districtId: dbDist.id,
                                pathaoId: thana.pathao_id?.toString(),
                                rdxId: thana.rdx_id?.toString(),
                                zipCode: thana.zip_code?.toString(),
                            },
                        });

                        // Fetch and Sync Areas
                        const areasResponse = await this.roadRush.getAreas(thana.id);
                        for (const area of areasResponse.data) {
                            await this.prisma.getClient().area.upsert({
                                where: { externalId: area.id },
                                update: {
                                    name: area.name,
                                    rdxId: area.rdx_id?.toString(),
                                },
                                create: {
                                    name: area.name,
                                    externalId: area.id,
                                    thanaId: dbThana.id,
                                    rdxId: area.rdx_id?.toString(),
                                },
                            });
                        }
                    }
                }
                logger.info(`Successfully completed syncing Division: ${div.name}`);
            }
            logger.info("Logistics location synchronization completed successfully");
        } catch (error) {
            logger.error("Logistics location synchronization failed", {
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
}
