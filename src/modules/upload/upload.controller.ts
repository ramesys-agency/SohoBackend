import { type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { getDummyUrl } from "./upload.helper.js";

const storage = multer.memoryStorage();
export const upload = multer({ storage });

export class UploadController {
    uploadFile = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                res.status(400).json({ message: "No file uploaded" });
                return;
            }

            const file = req.file;
            const dummyUrl = getDummyUrl(file);

            if (!dummyUrl) {
                res.status(400).json({
                    message: "Invalid file type. Only images and videos are allowed.",
                });
                return;
            }

            res.status(200).json({
                message: "File uploaded successfully",
                data: {
                    url: dummyUrl,
                    filename: file.originalname,
                    mimetype: file.mimetype,
                },
            });
        } catch (error) {
            next(error);
        }
    };
}
