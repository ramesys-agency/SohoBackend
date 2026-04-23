import { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { StorageService } from "../../core/services/storage.service.js";
import { randomBytes } from "crypto";

const storage = multer.memoryStorage();
export const upload = multer({ storage });

export class UploadController {
    private storageService = new StorageService();

    uploadFile = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                res.status(400).json({ message: "No file uploaded" });
                return;
            }

            const file = req.file;
            const folder = (req.body.folder as string) || "uploads";
            const fileName = (req.body.fileName as string) || "file";
            
            // Format: folder/fileName_randomId.ext
            const fileExt = file.originalname.split(".").pop();
            const randomId = randomBytes(4).toString("hex");
            const key = `${folder}/${fileName}_${randomId}.${fileExt}`;

            const url = await this.storageService.uploadFile(
                file.buffer,
                key,
                file.mimetype
            );

            res.status(200).json({
                message: "File uploaded successfully",
                data: {
                    url,
                    filename: file.originalname,
                    mimetype: file.mimetype,
                    key,
                },
            });
        } catch (error) {
            next(error);
        }
    };
}
