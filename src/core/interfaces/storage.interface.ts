export interface IStorageService {
    uploadFile(fileBuffer: Buffer, key: string, contentType: string): Promise<string>;
    getFileUrl(key: string): string;
    deleteFile(key: string): Promise<void>;
    getSignedUploadUrl(key: string, contentType: string, expiresAlt?: number): Promise<string>;
    ensureBucketExists(): Promise<void>;
}
