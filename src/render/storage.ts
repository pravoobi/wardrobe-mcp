import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { config } from "../config.js";

/** Where rendered looks live. Local dev writes to `./renders` and serves it
 * statically; prod puts objects in S3 behind CloudFront. Both expose the same
 * two operations and the same public-URL shape. */
export interface RenderStorage {
  putRender(key: string, webp: Buffer): Promise<string>;
  putCompare(key: string, webp: Buffer): Promise<string>;
  getRender(key: string): Promise<Buffer | undefined>;
  getCompare(key: string): Promise<Buffer | undefined>;
  publicRenderUrl(key: string): string;
  publicCompareUrl(key: string): string;
}

class LocalStorage implements RenderStorage {
  private readonly dir = config.localRenderDir;

  private async write(rel: string, buf: Buffer): Promise<void> {
    const path = join(this.dir, rel);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
  }

  async putRender(key: string, webp: Buffer): Promise<string> {
    await this.write(`${key}.webp`, webp);
    return this.publicRenderUrl(key);
  }

  async putCompare(key: string, webp: Buffer): Promise<string> {
    await this.write(`compare/${key}.webp`, webp);
    return this.publicCompareUrl(key);
  }

  async getRender(key: string): Promise<Buffer | undefined> {
    const path = join(this.dir, `${key}.webp`);
    if (!existsSync(path)) return undefined;
    return readFile(path);
  }

  async getCompare(key: string): Promise<Buffer | undefined> {
    const path = join(this.dir, "compare", `${key}.webp`);
    if (!existsSync(path)) return undefined;
    return readFile(path);
  }

  publicRenderUrl(key: string): string {
    return `${config.publicRenderBaseUrl}/${key}.webp`;
  }

  publicCompareUrl(key: string): string {
    return `${config.publicRenderBaseUrl}/compare/${key}.webp`;
  }
}

/** In-process storage for tests — no disk writes. */
export class MemoryStorage implements RenderStorage {
  private readonly blobs = new Map<string, Buffer>();
  async putRender(key: string, webp: Buffer): Promise<string> {
    this.blobs.set(key, webp);
    return this.publicRenderUrl(key);
  }
  async putCompare(key: string, webp: Buffer): Promise<string> {
    this.blobs.set(`compare/${key}`, webp);
    return this.publicCompareUrl(key);
  }
  async getRender(key: string): Promise<Buffer | undefined> {
    return this.blobs.get(key);
  }
  async getCompare(key: string): Promise<Buffer | undefined> {
    return this.blobs.get(`compare/${key}`);
  }
  publicRenderUrl(key: string): string {
    return `${config.publicRenderBaseUrl}/${key}.webp`;
  }
  publicCompareUrl(key: string): string {
    return `${config.publicRenderBaseUrl}/compare/${key}.webp`;
  }
}

let singleton: RenderStorage | undefined;

export function getStorage(): RenderStorage {
  if (singleton) return singleton;
  if (config.storage === "s3") {
    // Phase 3: @aws-sdk/client-s3 PutObject + CloudFront URL. Falls back to
    // local so nothing breaks before the AWS wiring lands.
    console.warn("STORAGE=s3 not implemented yet — using local disk.");
  }
  singleton = new LocalStorage();
  return singleton;
}

// Back-compat shims for earlier call sites.
export function publicUrlForKey(key: string): string {
  return getStorage().publicRenderUrl(key);
}
export function compareUrlForKey(key: string): string {
  return getStorage().publicCompareUrl(key);
}
