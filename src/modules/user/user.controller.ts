import type { Request, Response } from "express";
import { z } from "zod";
import { UserService } from "./user.service.js";
import { updateProfileSchema, createAdminSchema } from "./user.type.js";
import { StorageService } from "../../core/services/storage.service.js";
import { AuthUtils } from "../auth/auth.utils.js";

export class UserController {
    private userService = new UserService();
    private storageService = new StorageService();

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

            const file = req.file;
            const fileExt = file.originalname.split(".").pop();
            const key = `avatars/${userId}_${Date.now()}.${fileExt}`;

            const avatarUrl = await this.storageService.uploadFile(
                file.buffer,
                key,
                file.mimetype
            );

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
            const region = req.query.region as string | undefined;
            const role = req.query.role as string | undefined;
            const showDeleted = req.query.showDeleted as string | undefined;

            const result = await this.userService.getAllUsers({
                page,
                limit,
                ...(search ? { search } : {}),
                ...(region ? { region } : {}),
                ...(role ? { role } : {}),
                ...(showDeleted ? { showDeleted } : {}),
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

    createAdmin = async (req: Request, res: Response) => {
        try {
            const body = createAdminSchema.parse(req.body);
            const passwordHash = await AuthUtils.hashPassword(body.password);
            
            const newAdmin = await this.userService.createAdmin({
                email: body.email,
                fullName: body.fullName,
                passwordHash,
                ...(body.phone ? { phone: body.phone } : {}),
                ...(body.region ? { region: body.region } : {}),
            });

            res.status(201).json({
                message: "Admin created successfully",
                data: newAdmin,
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                return res.status(400).json({ message: "Validation error", errors: error.issues });
            }
            if (error && (error as any).message === "User with this email already exists") {
                return res.status(409).json({ message: (error as any).message });
            }
            console.error("Error creating admin:", error);
            res.status(500).json({ message: "Internal server error" });
        }
    };
}

