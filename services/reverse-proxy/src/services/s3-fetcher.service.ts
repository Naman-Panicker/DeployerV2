import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from '@deployer/config';
import { Readable } from 'node:stream';

let s3ClientInstance: S3Client | null = null;

export function isS3Configured(): boolean {
  if (s3ClientInstance) {
    return true;
  }
  return Boolean(
    env.AWS_ACCESS_KEY_ID &&
    env.AWS_ACCESS_KEY_ID !== 'your-access-key-id' &&
    env.AWS_SECRET_ACCESS_KEY &&
    env.AWS_SECRET_ACCESS_KEY !== 'your-secret-access-key'
  );
}

export function setS3Client(client: S3Client | null): void {
  s3ClientInstance = client;
}

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: env.AWS_REGION || 'ap-south-1',
    };

    if (isS3Configured()) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    s3ClientInstance = new S3Client(config);
  }

  return s3ClientInstance;
}

export interface S3FetchResult {
  body: Readable;
  contentType?: string;
  contentLength?: number;
  etag?: string;
  lastModified?: Date;
}

export class S3NotConfiguredError extends Error {
  constructor(message = 'AWS S3 credentials are not configured') {
    super(message);
    this.name = 'S3NotConfiguredError';
  }
}

/**
 * Checks if an error thrown by S3 represents a missing object (404).
 */
export function isS3NotFoundError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const errorObj = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    errorObj.name === 'NoSuchKey' ||
    errorObj.name === 'NotFound' ||
    errorObj.$metadata?.httpStatusCode === 404
  );
}

/**
 * Fetches an object from the S3 bucket under the live output prefix:
 * `__outputs/<projectId>/<filePath>`
 */
export async function fetchFromS3(
  projectId: string,
  filePath: string
): Promise<S3FetchResult> {
  if (!isS3Configured()) {
    throw new S3NotConfiguredError();
  }

  const bucketName = env.S3_BUCKET_NAME || 'deployer-artifacts';
  const cleanPath = filePath.replace(/^\/+/, '');
  const key = `__outputs/${projectId}/${cleanPath}`;

  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  const response = await client.send(command);

  return {
    body: response.Body as Readable,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}
