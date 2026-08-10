import multer from "multer";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { BadRequestError } from "../../core/errors/http-errors.js";

/**
 * Multer is configured with memory storage, so every byte of an upload sits in
 * the process heap until it reaches object storage. Without a size limit one
 * request can take the container down, which is why the limits below are not
 * optional.
 */
const MB = 1024 * 1024;

export const MAX_IMAGE_BYTES = 5 * MB;
export const MAX_VIDEO_BYTES = 25 * MB;

const IMAGE_MIME_TYPES = new Map<string, string>([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["image/avif", "avif"],
    ["image/heic", "heic"],
]);

const VIDEO_MIME_TYPES = new Map<string, string>([
    ["video/mp4", "mp4"],
    ["video/quicktime", "mov"],
    ["video/webm", "webm"],
]);

/** The extension we trust — derived from the declared type, never from the filename. */
export function extensionFor(mimetype: string): string | null {
    return IMAGE_MIME_TYPES.get(mimetype) ?? VIDEO_MIME_TYPES.get(mimetype) ?? null;
}

type FileFilter = NonNullable<multer.Options["fileFilter"]>;

function filterByType(allowed: Map<string, string>): FileFilter {
    return (_req, file, cb) => {
        if (allowed.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(
            new BadRequestError(
                `Unsupported file type "${file.mimetype}". Allowed: ${[...allowed.keys()].join(", ")}`
            )
        );
    };
}

/** Single images — avatars, banners, promo and placement artwork. */
export const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 20 },
    fileFilter: filterByType(IMAGE_MIME_TYPES),
});

/** Review attachments, which may include short clips. */
export const reviewMediaUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_VIDEO_BYTES, files: 7, fields: 20 },
    fileFilter: filterByType(new Map([...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES])),
});

const SAFE_SEGMENT = /[^a-zA-Z0-9_-]/g;

/**
 * Build an object key from caller-supplied parts.
 *
 * `folder` and `fileName` arrive in the request body, so they are reduced to a
 * single flat segment each — otherwise "../" walks out of the intended prefix
 * and writes anywhere in the bucket.
 */
export function buildObjectKey(options: {
    folder?: string | undefined;
    fileName?: string | undefined;
    mimetype: string;
    defaultFolder?: string;
}): string {
    const { folder, fileName, mimetype, defaultFolder = "uploads" } = options;

    const ext = extensionFor(mimetype);
    if (!ext) {
        throw new BadRequestError(`Unsupported file type "${mimetype}"`);
    }

    const safeFolder =
        path.basename(String(folder ?? "")).replace(SAFE_SEGMENT, "") || defaultFolder;
    const safeName = path.basename(String(fileName ?? "")).replace(SAFE_SEGMENT, "") || "file";
    const randomId = randomBytes(8).toString("hex");

    return `${safeFolder}/${safeName}_${randomId}.${ext}`;
}
