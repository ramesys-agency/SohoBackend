import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../../config/index.js";
import { LoggerService } from "./logger.service.js";
import type { IStorageService } from "../interfaces/index.js";

/**
 * StorageService provides an S3-compatible interface for file storage.
 * It supports both AWS S3 and local MinIO development.
 */
export class StorageService implements IStorageService {
    private client: S3Client;
    private signingClient: S3Client;
    private bucketName: string;
    private logger: LoggerService;

    constructor() {
        this.logger = new LoggerService();
        this.bucketName = config.storage.bucket;

        const s3Config: any = {
            region: config.storage.region,
            credentials: {
                accessKeyId: config.storage.accessKey,
                secretAccessKey: config.storage.secretKey,
            },
        };

        // Automatic switch to MinIO if type is set
        if (config.storage.type === "minio") {
            s3Config.endpoint = config.storage.endpoint;
            s3Config.forcePathStyle = true;
        }

        this.client = new S3Client(s3Config);
        
        // If a public endpoint is provided (e.g. for MinIO in Docker), 
        // create a separate client for generating signed URLs.
        if (config.storage.type === "minio" && config.storage.publicEndpoint) {
            this.signingClient = new S3Client({
                ...s3Config,
                endpoint: config.storage.publicEndpoint,
            });
        } else {
            this.signingClient = this.client;
        }
    }

    /**
     * Checks if the bucket exists and creates it if it doesn't (useful for MinIO dev).
     */
    async ensureBucketExists(): Promise<void> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
        } catch (error: any) {
            // S3 v3 NotFound error handling
            if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
                this.logger.info(`Bucket "${this.bucketName}" not found. Creating...`);
                await this.client.send(new CreateBucketCommand({ Bucket: this.bucketName }));
                this.logger.info(`Bucket "${this.bucketName}" created successfully.`);
            } else {
                this.logger.error(`Error checking/creating bucket "${this.bucketName}":`, error);
                throw error;
            }
        }
    }

    /**
     * Uploads a file buffer to S3/MinIO.
     * @returns The public or semi-private URL of the uploaded file.
     */
    async uploadFile(fileBuffer: Buffer, key: string, contentType: string): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            Body: fileBuffer,
            ContentType: contentType,
        });

        try {
            await this.client.send(command);
            this.logger.info(`File uploaded successfully: ${key}`);
            return this.getFileUrl(key);
        } catch (error: any) {
            this.logger.error(`Error uploading file "${key}" to storage:`, error);
            throw error;
        }
    }

    /**
     * Constructs the URL for a given file key.
     */
    getFileUrl(key: string): string {
        if (config.storage.type === "minio") {
            // Use publicEndpoint if available, otherwise fallback to internal endpoint
            const endpoint = (config.storage.publicEndpoint || config.storage.endpoint)?.replace(/\/$/, "");
            return `${endpoint}/${this.bucketName}/${key}`;
        }
        // For standard S3
        return `https://${this.bucketName}.s3.${config.storage.region}.amazonaws.com/${key}`;
    }

    /**
     * Deletes a file from S3/MinIO.
     */
    async deleteFile(key: string): Promise<void> {
        const command = new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
        });

        try {
            await this.client.send(command);
            this.logger.info(`File deleted successfully: ${key}`);
        } catch (error: any) {
            this.logger.error(`Error deleting file "${key}" from storage:`, error);
            throw error;
        }
    }

    /**
     * Generates a pre-signed URL for client-side uploads.
     */
    async getSignedUploadUrl(key: string, contentType: string, expiresAlt = 3600): Promise<string> {
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: key,
            ContentType: contentType,
        });

        try {
            return await getSignedUrl(this.signingClient, command, { expiresIn: expiresAlt });
        } catch (error: any) {
            this.logger.error(`Error generating signed upload URL for "${key}":`, error);
            throw error;
        }
    }
}
