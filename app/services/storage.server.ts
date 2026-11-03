import { env } from "../config.server.ts";

export interface StorageAdapter {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

let cached: StorageAdapter | null | undefined;

/** Returns null when storage is not configured; photo uploads are then switched off everywhere. */
export async function getStorage(): Promise<StorageAdapter | null> {
  if (cached !== undefined) return cached;
  const cfg = env.storage;
  if (!cfg) return (cached = null);
  const { S3Client, PutObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({ region: cfg.region, endpoint: cfg.endpoint, credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, forcePathStyle: true });
  cached = {
    async put(key, bytes, mime) {
      // Content type comes from detected file contents, and attachment disposition stops browsers rendering it as a page.
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: bytes, ContentType: mime, CacheControl: "public, max-age=31536000, immutable", ContentDisposition: "inline", Metadata: {} }));
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key })); },
    publicUrl: (key) => `${cfg.publicBaseUrl}/${key}`,
  };
  return cached;
}
