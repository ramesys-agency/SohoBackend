import { type Request, type Response, type NextFunction } from "express";
import { StorageService } from "../../core/services/storage.service.js";
import { buildObjectKey } from "./upload.config.js";

// Re-exported so the modules that already import `upload` from here keep
// working — they now get the size- and type-limited instance.
export { upload, reviewMediaUpload } from "./upload.config.js";

export class UploadController {
    private storageService = new StorageService();

    uploadFile = async (req: Request, res: Response, next: NextFunction) => {
        try {
            if (!req.file) {
                res.status(400).json({ message: "No file uploaded" });
                return;
            }

            const file = req.file;

            // Format: folder/fileName_randomId.ext — every part sanitised, and
            // the extension taken from the verified MIME type rather than from
            // the client's filename.
            const key = buildObjectKey({
                folder: req.body.folder as string | undefined,
                fileName: req.body.fileName as string | undefined,
                mimetype: file.mimetype,
            });

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
