import type { Express } from "express";

export const getDummyUrl = (file: Express.Multer.File): string => {
    if (file.mimetype.startsWith("image/")) {
        return "https://dummy-image-url.com/" + file.originalname;
    } else if (file.mimetype.startsWith("video/")) {
        return "https://dummy-video-url.com/" + file.originalname;
    }
    return "";
};
