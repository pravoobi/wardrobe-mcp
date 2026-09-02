import { config } from "../config.js";

/** Maps a render cache key to its public HTTPS URL. Local dev serves from disk;
 * prod serves from CloudFront. Both are pure string maps — no I/O here. */
export function publicUrlForKey(key: string): string {
  return `${config.publicRenderBaseUrl}/${key}.webp`;
}

export function compareUrlForKey(key: string): string {
  return `${config.publicRenderBaseUrl}/compare/${key}.webp`;
}
