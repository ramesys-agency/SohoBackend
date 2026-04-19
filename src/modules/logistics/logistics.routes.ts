import { Router } from "express";
import { LogisticsController } from "./logistics.controller.js";
import { authMiddleware, adminMiddleware } from "../../core/middleware/auth.middleware.js";

const router = Router();
const controller = new LogisticsController();

/**
 * Public/User Location Routes
 */
router.get("/divisions", controller.getDivisions);
router.get("/districts", controller.getDistricts);
router.get("/thanas", controller.getThanas);
router.get("/areas", controller.getAreas);

/**
 * Logistics Integration Routes
 */
router.get("/aggregators", authMiddleware, controller.getAggregators);

/**
 * Pickup Address Routes (Admin/Merchant)
 */
router.get("/pickup-addresses", authMiddleware, adminMiddleware, controller.getPickupAddresses);
router.post("/pickup-addresses", authMiddleware, adminMiddleware, controller.addPickupAddress);

/**
 * Admin Sync Routes
 */
// router.post("/sync-locations", authMiddleware, adminMiddleware, controller.syncLocations);
router.post("/sync-locations", controller.syncLocations);

export default router;
