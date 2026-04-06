# Storage Service Usage Guide

This guide explains how to set up and use the `StorageService` in the SohoBackend project.

## 1. Local Development with MinIO (Docker)

Run the following command to start a MinIO instance locally.

```bash
docker run -p 9000:9000 -p 9001:9001 \
  --name minio \
  -e "MINIO_ROOT_USER=minioadmin" \
  -e "MINIO_ROOT_PASSWORD=minioadmin" \
  minio/minio server /data --console-address ":9001"
```

*   **API Port**: 9000
*   **Console Port**: 9001 (accessible at http://localhost:9001)
*   **Credentials**: `minioadmin` / `minioadmin`

## 2. Environment Configuration

Ensure your `.env` file has the following storage settings:

### Local (MinIO)
```env
STORAGE=minio
BUCKET_NAME=soho-bucket
ACCESS_KEY=minioadmin
SECRET_KEY=minioadmin
AWS_REGION=us-east-1
ENDPOINT=http://localhost:9000
```

### Production (AWS S3)
```env
STORAGE=s3
BUCKET_NAME=your-s3-bucket-name
ACCESS_KEY=your-aws-access-key-id
SECRET_KEY=your-aws-secret-access-key
AWS_REGION=eu-west-1
# ENDPOINT is optional for AWS S3
```

## 3. Example Usage

```typescript
import { StorageService } from './core/services/storage.service.js';
import fs from 'fs';

const storage = new StorageService();

async function main() {
  // 1. (Optional for MinIO) Ensure bucket exists
  await storage.ensureBucketExists();

  // 2. Upload a file
  const fileBuffer = fs.readFileSync('path/to/my-image.png');
  const fileUrl = await storage.uploadFile(fileBuffer, 'uploads/my-image.png', 'image/png');
  console.log('File uploaded to:', fileUrl);

  // 3. Get file URL
  const url = storage.getFileUrl('uploads/my-image.png');
  console.log('Constructed URL:', url);

  // 4. Generate signed URL for 5-minute upload session
  const signedUrl = await storage.getSignedUploadUrl('uploads/user-avatar.png', 'image/png', 300);
  console.log('Signed upload URL:', signedUrl);

  // 5. Delete file
  await storage.deleteFile('uploads/my-image.png');
  console.log('File deleted!');
}

main().catch(console.error);
```
