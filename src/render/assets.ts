import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";

const CACHE_DIR = join("data", "assets");

async function cached(name: string, fetchUrl: string): Promise<Buffer> {
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) return readFile(path);
  const res = await fetch(fetchUrl);
  if (!res.ok) throw new Error(`asset fetch ${fetchUrl} -> ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, buf);
  return buf;
}

/**
 * Resolve a stored photo reference to image bytes.
 * - `tryon:photo-01`  → the try-on app's bundled test photo
 * - `http(s)://…`      → fetched as-is
 * - anything else      → a local file under `data/photos/`
 */
export async function loadPhotoBytes(s3Key: string): Promise<Buffer> {
  if (s3Key.startsWith("tryon:")) {
    const id = s3Key.slice("tryon:".length);
    return cached(`${id}.jpg`, `${trimSlash(config.tryonAppUrl)}/test-photos/${id}.jpg`);
  }
  if (/^https?:\/\//.test(s3Key)) {
    const res = await fetch(s3Key);
    if (!res.ok) throw new Error(`photo fetch ${s3Key} -> ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const path = join("data", "photos", s3Key.replace(/^\/+/, ""));
  if (!existsSync(path)) throw new Error(`photo not found: ${path}`);
  return readFile(path);
}

/** The flat garment PNG (transparent) the try-on app renders from. */
export async function loadGarmentBytes(garmentId: string): Promise<Buffer> {
  return cached(`${garmentId}.png`, `${trimSlash(config.tryonAppUrl)}/garments/${garmentId}.png`);
}

const trimSlash = (u: string): string => u.replace(/\/+$/, "");
