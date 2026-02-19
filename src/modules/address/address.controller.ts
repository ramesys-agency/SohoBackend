import type { Request, Response } from "express";
import { z } from "zod";
import { AddressService } from "./address.service.js";
import { createAddressSchema, updateAddressSchema } from "./address.type.js";

export class AddressController {
    private addressService = new AddressService();

    getAddresses = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const addresses = await this.addressService.getAddresses(userId);

            res.status(200).json({
                message: "Addresses fetched successfully",
                data: addresses,
            });
        } catch (error) {
            console.error("Error fetching addresses:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    getAddressById = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const id = req.params["id"] as string;

            const address = await this.addressService.getAddressById(id, userId);
            if (!address) {
                return res.status(404).json({ message: "Address not found" });
            }

            res.status(200).json({
                message: "Address fetched successfully",
                data: address,
            });
        } catch (error) {
            console.error("Error fetching address:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    createAddress = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const data = createAddressSchema.parse(req.body);

            const address = await this.addressService.createAddress(userId, data);

            res.status(201).json({
                message: "Address created successfully",
                data: address,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation error", errors: error.issues });
            }
            console.error("Error creating address:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    updateAddress = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const id = req.params["id"] as string;
            const data = updateAddressSchema.parse(req.body);

            const address = await this.addressService.updateAddress(id, userId, data);
            if (!address) {
                return res.status(404).json({ message: "Address not found" });
            }

            res.status(200).json({
                message: "Address updated successfully",
                data: address,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation error", errors: error.issues });
            }
            console.error("Error updating address:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    setDefault = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const id = req.params["id"] as string;

            const address = await this.addressService.setDefault(id, userId);
            if (!address) {
                return res.status(404).json({ message: "Address not found" });
            }

            res.status(200).json({
                message: "Default address updated successfully",
                data: address,
            });
        } catch (error) {
            console.error("Error setting default address:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    deleteAddress = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const id = req.params["id"] as string;

            const deleted = await this.addressService.deleteAddress(id, userId);
            if (!deleted) {
                return res.status(404).json({ message: "Address not found" });
            }

            res.status(200).json({
                message: "Address deleted successfully",
            });
        } catch (error) {
            console.error("Error deleting address:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };
}
