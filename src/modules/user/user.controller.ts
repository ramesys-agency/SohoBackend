import type { Request, Response } from "express";
import { z } from "zod";
import { UserService } from "./user.service.js";
import { updateProfileSchema } from "./user.type.js";
import { getDummyUrl } from "../upload/upload.helper.js";

export class UserController {
    private userService = new UserService();

    updateProfile = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const data = updateProfileSchema.parse(req.body);

            const updatedUser = await this.userService.updateProfile(userId, data);

            res.status(200).json({
                message: "Profile updated successfully",
                data: updatedUser,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation error", errors: error });
            }
            console.error("Error updating profile:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    updateAvatar = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            if (!req.file) {
                return res.status(400).json({ message: "No file uploaded" });
            }

            const avatarUrl = getDummyUrl(req.file);

            if (!avatarUrl) {
                return res.status(400).json({ message: "Invalid file type" });
            }

            const updatedUser = await this.userService.updateAvatar(userId, avatarUrl);

            res.status(200).json({
                message: "Avatar updated successfully",
                data: updatedUser,
            });
        } catch (error) {
            console.error("Error updating avatar:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    getProfile = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            const user = await this.userService.getProfile(userId);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.status(200).json({
                message: "Profile fetched successfully",
                data: user,
            });
        } catch (error) {
            console.error("Error fetching profile:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    getAllUsers = async (req: Request, res: Response) => {
        try {
            const page = req.query.page ? Number(req.query.page) : 1;
            const limit = req.query.limit ? Number(req.query.limit) : 20;
            const search = req.query.search as string | undefined;

            const result = await this.userService.getAllUsers({
                page,
                limit,
                ...(search ? { search } : {}),
            });

            res.status(200).json({
                message: "Users fetched successfully",
                ...result,
            });
        } catch (error) {
            console.error("Error fetching users:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    deleteAccount = async (req: Request, res: Response) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }

            await this.userService.deleteAccount(userId);

            res.status(200).json({
                message: "Account deleted successfully",
            });
        } catch (error) {
            console.error("Error deleting account:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };

    getUserById = async (req: Request, res: Response) => {
        try {
            const { id } = req.params;
            if (!id) {
                return res.status(400).json({ message: "User ID is required" });
            }

            const user = await this.userService.getProfile(id as string);
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }

            res.status(200).json({
                message: "User fetched successfully",
                data: user,
            });
        } catch (error) {
            console.error("Error fetching user by ID:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };
}
