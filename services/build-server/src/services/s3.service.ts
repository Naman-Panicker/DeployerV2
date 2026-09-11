import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { createPresignedPost, PresignedPost } from '@aws-sdk/s3-presigned-post';
import { env } from '@deployer/config';
import pLimit from 'p-limit';

const MAX_CONCURRENT_OPERATIONS = 5;

let s3ClientInstance: S3Client | null = null;

export function isPlaceholderCredentials(): boolean {
  return (
    !env.AWS_ACCESS_KEY_ID ||
    env.AWS_ACCESS_KEY_ID === 'your-access-key-id' ||
    !env.AWS_SECRET_ACCESS_KEY ||
    env.AWS_SECRET_ACCESS_KEY === 'your-secret-access-key'
  );
}

export function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config: {
      region: string;
      credentials?: { accessKeyId: string; secretAccessKey: string };
    } = {
      region: env.AWS_REGION || 'ap-south-1',
    };

    if (!isPlaceholderCredentials()) {
      config.credentials = {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      };
    }

    s3ClientInstance = new S3Client(config);
  }
  return s3ClientInstance;
}

/**
 * Checks if the target S3 bucket exists, and creates it if not.
 */
export async function initializeBucket(): Promise<boolean> {
  const bucketName = env.S3_BUCKET_NAME || 'deployer-artifacts';
  const client = getS3Client();

  if (isPlaceholderCredentials()) {
    console.warn(
      `[Build Server S3] AWS S3 credentials are placeholders or not configured. Bucket check skipped.`
    );
    return false;
  }

  try {
    console.log(`[Build Server S3] Checking S3 bucket: ${bucketName}...`);
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    console.log(`[Build Server S3] S3 bucket '${bucketName}' exists and is accessible.`);
    return true;
  } catch (err: unknown) {
    const errorName = (err as { name?: string })?.name;
    const statusCode = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;

    if (errorName === 'NotFound' || statusCode === 404) {
      console.log(`[Build Server S3] Bucket '${bucketName}' not found. Creating...`);
      try {
        await client.send(
          new CreateBucketCommand({
            Bucket: bucketName,
            CreateBucketConfiguration:
              env.AWS_REGION === 'us-east-1'
                ? undefined
                : { LocationConstraint: env.AWS_REGION as any },
          })
        );
        console.log(`[Build Server S3] Created S3 bucket '${bucketName}' successfully.`);
        return true;
      } catch (createErr) {
        console.error(`[Build Server S3] Failed to create S3 bucket '${bucketName}':`, createErr);
        return false;
      }
    }

    console.warn(
      `[Build Server S3] Could not verify S3 bucket '${bucketName}':`,
      err instanceof Error ? err.message : String(err)
    );
    return false;
  }
}

export interface PresignedFormConfig {
  url: string;
  fields: Record<string, string>;
  prefix: string;
}

export interface PresignedUploadForms {
  isPlaceholder: boolean;
  bucket: string;
  outputs: PresignedFormConfig;
  history: PresignedFormConfig;
}

/**
 * Generates presigned POST forms for:
 * 1. Live serving path: __outputs/<projectId>/
 * 2. Immutable history path: __history/<projectId>/<deploymentId>/
 *
 * Each form allows uploading files prefixed with its respective path,
 * valid for 10 minutes (600 seconds).
 */
export async function generatePresignedForms(
  projectId: string,
  deploymentId: string
): Promise<PresignedUploadForms> {
  const bucketName = env.S3_BUCKET_NAME || 'deployer-artifacts';
  const client = getS3Client();
  const placeholder = isPlaceholderCredentials();

  const outputsPrefix = `__outputs/${projectId}/`;
  const historyPrefix = `__history/${projectId}/${deploymentId}/`;

  if (placeholder) {
    return {
      isPlaceholder: true,
      bucket: bucketName,
      outputs: {
        url: `https://${bucketName}.s3.${env.AWS_REGION || 'ap-south-1'}.amazonaws.com/`,
        fields: {
          bucket: bucketName,
          key: `${outputsPrefix}\${filename}`,
        },
        prefix: outputsPrefix,
      },
      history: {
        url: `https://${bucketName}.s3.${env.AWS_REGION || 'ap-south-1'}.amazonaws.com/`,
        fields: {
          bucket: bucketName,
          key: `${historyPrefix}\${filename}`,
        },
        prefix: historyPrefix,
      },
    };
  }

  const [outputsPost, historyPost] = await Promise.all([
    createPresignedPost(client, {
      Bucket: bucketName,
      Key: `${outputsPrefix}\${filename}`,
      Conditions: [
        ['starts-with', '$key', outputsPrefix],
        ['starts-with', '$Content-Type', ''],
      ],
      Expires: 600, // 10 minutes
    }),
    createPresignedPost(client, {
      Bucket: bucketName,
      Key: `${historyPrefix}\${filename}`,
      Conditions: [
        ['starts-with', '$key', historyPrefix],
        ['starts-with', '$Content-Type', ''],
      ],
      Expires: 600, // 10 minutes
    }),
  ]);

  return {
    isPlaceholder: false,
    bucket: bucketName,
    outputs: {
      url: outputsPost.url,
      fields: outputsPost.fields,
      prefix: outputsPrefix,
    },
    history: {
      url: historyPost.url,
      fields: historyPost.fields,
      prefix: historyPrefix,
    },
  };
}

export interface CopyResult {
  success: boolean;
  copiedCount: number;
  errorMessage?: string;
}

/**
 * Copies artifacts from one S3 prefix to another within the same bucket.
 * Primarily used for rollback (e.g. __history/<proj>/<deploy>/ -> __outputs/<proj>/).
 */
export async function copyArtifactsInS3(
  sourcePrefix: string,
  destinationPrefix: string
): Promise<CopyResult> {
  const bucketName = env.S3_BUCKET_NAME || 'deployer-artifacts';
  const client = getS3Client();

  if (isPlaceholderCredentials()) {
    console.warn(
      `[Build Server S3] AWS credentials are placeholder/mock. Simulating successful copy from '${sourcePrefix}' to '${destinationPrefix}'.`
    );
    return {
      success: true,
      copiedCount: 1,
    };
  }

  try {
    const normalizedSource = sourcePrefix.endsWith('/') ? sourcePrefix : `${sourcePrefix}/`;
    const normalizedDest = destinationPrefix.endsWith('/') ? destinationPrefix : `${destinationPrefix}/`;

    let continuationToken: string | undefined;
    let totalCopied = 0;
    const limit = pLimit(MAX_CONCURRENT_OPERATIONS);

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: normalizedSource,
        ContinuationToken: continuationToken,
      });

      const listResponse = await client.send(listCommand);
      const objects = listResponse.Contents || [];

      if (objects.length === 0 && totalCopied === 0) {
        return {
          success: false,
          copiedCount: 0,
          errorMessage: `No artifacts found under source prefix: ${sourcePrefix}`,
        };
      }

      const copyTasks = objects
        .filter((obj) => obj.Key && obj.Key !== normalizedSource)
        .map((obj) =>
          limit(async () => {
            const key = obj.Key!;
            const relativeKey = key.slice(normalizedSource.length);
            const destinationKey = `${normalizedDest}${relativeKey}`;
            const safeCopySource = `${bucketName}/${key.split('/').map(encodeURIComponent).join('/')}`;

            await client.send(
              new CopyObjectCommand({
                Bucket: bucketName,
                CopySource: safeCopySource,
                Key: destinationKey,
              })
            );
            totalCopied++;
          })
        );

      await Promise.all(copyTasks);
      continuationToken = listResponse.NextContinuationToken;
    } while (continuationToken);

    console.log(
      `[Build Server S3] Successfully copied ${totalCopied} artifacts from ${sourcePrefix} to ${destinationPrefix}`
    );

    return {
      success: true,
      copiedCount: totalCopied,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[Build Server S3] S3 copy error: ${errorMsg}`);
    return {
      success: false,
      copiedCount: 0,
      errorMessage: errorMsg,
    };
  }
}
