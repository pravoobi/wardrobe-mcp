import type { S3Client } from "@aws-sdk/client-s3";
import { config } from "../config.js";
import type { RenderStorage } from "./storage.js";

/**
 * Prod render storage: objects in S3, served over HTTPS by CloudFront.
 * Renders are write-once/read-many and content-addressed, so they're immutable
 * and cached hard at the edge.
 */
export class S3Storage implements RenderStorage {
  private clientP?: Promise<S3Client>;
  private readonly bucket: string;
  private readonly base: string;

  constructor() {
    if (!config.s3Bucket) throw new Error("STORAGE=s3 requires S3_BUCKET");
    if (!config.cloudfrontBaseUrl) throw new Error("STORAGE=s3 requires CLOUDFRONT_BASE_URL");
    this.bucket = config.s3Bucket;
    this.base = config.cloudfrontBaseUrl;
  }

  private async client(): Promise<S3Client> {
    this.clientP ??= import("@aws-sdk/client-s3").then((m) => new m.S3Client({ region: config.awsRegion }));
    return this.clientP;
  }

  private async put(objectKey: string, webp: Buffer): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await this.client();
    await s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: webp,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
  }

  private async get(objectKey: string): Promise<Buffer | undefined> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const s3 = await this.client();
    try {
      const r = await s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      const bytes = await r.Body?.transformToByteArray();
      return bytes ? Buffer.from(bytes) : undefined;
    } catch (err) {
      if ((err as { name?: string }).name === "NoSuchKey") return undefined;
      throw err;
    }
  }

  async putRender(key: string, webp: Buffer): Promise<string> {
    await this.put(`${key}.webp`, webp);
    return this.publicRenderUrl(key);
  }
  async putCompare(key: string, webp: Buffer): Promise<string> {
    await this.put(`compare/${key}.webp`, webp);
    return this.publicCompareUrl(key);
  }
  getRender(key: string): Promise<Buffer | undefined> {
    return this.get(`${key}.webp`);
  }
  getCompare(key: string): Promise<Buffer | undefined> {
    return this.get(`compare/${key}.webp`);
  }
  publicRenderUrl(key: string): string {
    return `${this.base}/${key}.webp`;
  }
  publicCompareUrl(key: string): string {
    return `${this.base}/compare/${key}.webp`;
  }
}
