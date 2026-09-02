/** Domain types shared across the store implementations and the MCP tools. */

export type Occasion = string;

export interface GarmentMeta {
  name: string;
  color: string;
  occasion: Occasion[];
  price?: number;
  /** Derived at load time from `price` and the catalog USD rate. */
  priceUsd?: number;
  sleeves?: string;
  length?: string;
  productUrl?: string;
}

export interface Garment {
  id: string;
  category: string;
  meta: GarmentMeta;
}

export interface User {
  id: string;
  displayName: string;
  primaryPhotoId?: string;
  createdAt: string;
}

export interface Photo {
  id: string;
  userId: string;
  s3Key: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export type WardrobeItemSource = "catalog" | "upload";

export interface WardrobeItem {
  id: string;
  userId: string;
  garmentId: string;
  source: WardrobeItemSource;
  addedAt: string;
  meta: GarmentMeta & { category: string };
}

export interface Look {
  /** "look-N" per user. */
  id: string;
  userId: string;
  garmentId: string;
  photoId: string;
  label?: string;
  renderKey: string;
  createdAt: string;
}

export type ReactionKind = "love" | "like" | "try_another" | "reject";

export interface Reaction {
  id: string;
  userId: string;
  lookId: string;
  kind: ReactionKind;
  note?: string;
  at: string;
}

/** OAuth 2.1 authorization code — single-use, ~60 s TTL, PKCE-bound. */
export interface AuthCode {
  /** sha256 of the code value. The plaintext is never stored. */
  codeHash: string;
  clientId: string;
  userId: string;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  /** RFC 8707 — must match the canonical MCP URL. */
  resource: string;
  expiresAt: number;
}

export type OAuthTokenKind = "access" | "refresh";

/** Opaque bearer/refresh token. Only the sha256 is persisted. */
export interface OAuthToken {
  tokenHash: string;
  kind: OAuthTokenKind;
  userId: string;
  scopes: string[];
  clientId: string;
  resource: string;
  expiresAt: number;
  /** Links an access token to the refresh token that minted it, for rotation. */
  refreshHash?: string;
}

export type RenderStatus = "queued" | "running" | "done" | "failed";

export interface RenderJob {
  key: string;
  userId: string;
  photoId: string;
  garmentId: string;
  status: RenderStatus;
  url?: string;
  error?: string;
  updatedAt: string;
}
