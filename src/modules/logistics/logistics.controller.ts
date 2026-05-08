import type { Request, Response, NextFunction } from "express";
import { LocationService } from "./location.service.js";
import { RoadRushService } from "./roadrush.service.js";
import { prisma as prismaService } from "../../config/prisma.js";

const locationService = new LocationService();
const roadRushService = new RoadRushService();
const prisma = prismaService.getClient();

/**
 * Logistics Controller
 * Handles location data, aggregators, and merchant settings.
 */
export class LogisticsController {
    // --- Locations ---

    async getDivisions(req: Request, res: Response, next: NextFunction) {
        try {
            const divisions = await locationService.getDivisions();
            res.json({ status: "success", data: divisions });
        } catch (error) {
            next(error);
        }
    }

    async getDistricts(req: Request, res: Response, next: NextFunction) {
        try {
            const { divisionId } = req.query;
            if (!divisionId) {
                return res.status(400).json({ status: "error", message: "divisionId is required" });
            }
            const districts = await locationService.getDistricts(divisionId as string);
            res.json({ status: "success", data: districts });
        } catch (error) {
            next(error);
        }
    }

    async getThanas(req: Request, res: Response, next: NextFunction) {
        try {
            const { districtId } = req.query;
            if (!districtId) {
                return res.status(400).json({ status: "error", message: "districtId is required" });
            }
            const thanas = await locationService.getThanas(districtId as string);
            res.json({ status: "success", data: thanas });
        } catch (error) {
            next(error);
        }
    }

    async getAreas(req: Request, res: Response, next: NextFunction) {
        try {
            const { thanaId } = req.query;
            if (!thanaId) {
                return res.status(400).json({ status: "error", message: "thanaId is required" });
            }
            const areas = await locationService.getAreas(thanaId as string);
            res.json({ status: "success", data: areas });
        } catch (error) {
            next(error);
        }
    }

    async syncLocations(req: Request, res: Response, next: NextFunction) {
        try {
            await locationService.syncAllLocations();
            res.json({
                status: "success",
                message: "Location synchronization completed successfully",
            });
        } catch (error) {
            next(error);
        }
    }

    // --- Aggregators ---

    async getAggregators(req: Request, res: Response, next: NextFunction) {
        try {
            const aggregators = await roadRushService.getAggregators();
            res.json(aggregators);
        } catch (error) {
            next(error);
        }
    }

    // --- Pickup Addresses ---

    async getPickupAddresses(req: Request, res: Response, next: NextFunction) {
        try {
            // Fetch live data from RoadRush
            const result = await roadRushService.getSenderAddresses();
            res.json(result);
        } catch (error) {
            next(error);
        }
    }

    async addPickupAddress(req: Request, res: Response, next: NextFunction) {
        try {
            const data = req.body;
            // 1. Send to RoadRush
            const rrResponse = await roadRushService.addPickupAddress({
                sender_name: data.name,
                sender_address: data.address,
                division: data.division,
                district: data.district,
                thana: data.thana,
                sender_phone: data.phone,
                sender_latitude: data.latitude?.toString(),
                sender_longitude: data.longitude?.toString(),
            });

            // 2. Save locally
            const address = await prisma.pickupAddress.create({
                data: {
                    name: data.name,
                    address: data.address,
                    division: data.division,
                    district: data.district,
                    thana: data.thana,
                    phone: data.phone,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    // Optionally store other fields from rrResponse if needed
                },
            });

            res.status(201).json({ status: "success", data: address });
        } catch (error) {
            next(error);
        }
    }
}
