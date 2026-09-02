import { z } from "zod";

/** What auto-tagging fills in for an uploaded garment so it's searchable by voice. */
export const GarmentTagSchema = z.object({
  name: z.string().min(1).max(80),
  color: z.string().min(1).max(30),
  category: z.string().min(1).max(40),
  occasion: z.array(z.string().min(1).max(30)).min(1).max(6),
});
export type GarmentTag = z.infer<typeof GarmentTagSchema>;

export interface Tagger {
  /** `image` is raw bytes; `mimeType` like "image/jpeg". */
  tag(image: Buffer, mimeType: string): Promise<GarmentTag>;
}

/** `TAGGING_PROVIDER=none` — the wardrobe is catalog-only, nothing to tag. */
export class NoneTagger implements Tagger {
  async tag(): Promise<GarmentTag> {
    throw new Error("Auto-tagging is disabled (TAGGING_PROVIDER=none). Add catalog items by id instead.");
  }
}
