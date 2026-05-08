import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    CreateBucketCommand,
    PutBucketPolicyCommand,
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

        // Base credentials shared by both clients
        const baseCredentials = {
            region: config.storage.region,
            credentials: {
                accessKeyId: config.storage.accessKey,
                secretAccessKey: config.storage.secretKey,
            },
        };

        // Main client: always uses the INTERNAL endpoint (fast, within Docker network).
        // Used for all actual operations: upload, delete, bucket check.
        if (config.storage.type === "minio") {
            this.client = new S3Client({
                ...baseCredentials,
                endpoint: config.storage.endpoint!, // internal: http://minio:9000
                forcePathStyle: true,
            });
        } else {
            this.client = new S3Client(baseCredentials);
        }

        // Signing client: used ONLY for generating pre-signed URLs for clients.
        // If STORAGE_PUBLIC_ENDPOINT is set, the signed URL host will be the public domain.
        // This does NOT affect upload/delete performance — it's never used for those.
        if (config.storage.type === "minio" && config.storage.publicEndpoint) {
            this.signingClient = new S3Client({
                ...baseCredentials,
                endpoint: config.storage.publicEndpoint, // public: https://minio.soho-bd.com
                forcePathStyle: true,
            });
        } else {
            this.signingClient = this.client;
        }
    }

    /**
     * Builds a public-read bucket policy that allows anonymous GET on all objects.
     */
    private getPublicReadPolicy(): string {
        return JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "PublicReadGetObject",
                    Effect: "Allow",
                    Principal: "*",
                    Action: "s3:GetObject",
                    Resource: `arn:aws:s3:::${this.bucketName}/*`,
                },
            ],
        });
    }

    /**
     * Applies the public-read policy to the bucket.
     * Safe to call on an already-public bucket — it's idempotent.
     */
    private async applyPublicReadPolicy(): Promise<void> {
        await this.client.send(
            new PutBucketPolicyCommand({
                Bucket: this.bucketName,
                Policy: this.getPublicReadPolicy(),
            })
        );
        this.logger.info(`Public-read policy applied to bucket "${this.bucketName}"`);
    }

    /**
     * Checks if the bucket exists and creates it if it doesn't.
     * Always applies a public-read policy so objects are directly accessible.
     */
    async ensureBucketExists(): Promise<void> {
        try {
            await this.client.send(new HeadBucketCommand({ Bucket: this.bucketName }));
            this.logger.info(`Bucket "${this.bucketName}" already exists.`);
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

        // Always enforce public-read policy (idempotent — safe on every startup)
        await this.applyPublicReadPolicy();
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
