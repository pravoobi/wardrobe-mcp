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
