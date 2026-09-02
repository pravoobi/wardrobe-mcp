import type {
  Look,
  Photo,
  Reaction,
  ReactionKind,
  RenderJob,
  RenderStatus,
  User,
  WardrobeItem,
} from "./types.js";

/**
 * Persistence port. Two implementations: `sqlite` (dev/tests) and `dynamodb`
 * (prod). Tools receive this through `ctx.store` and never import a concrete
 * impl, so the same test suite runs against both.
 */
export interface Store {
  getUser(userId: string): Promise<User | undefined>;
  upsertUser(user: User): Promise<User>;

  listPhotos(userId: string): Promise<Photo[]>;
  getPrimaryPhoto(userId: string): Promise<Photo | undefined>;
  addPhoto(photo: Photo): Promise<Photo>;

  listWardrobe(userId: string): Promise<WardrobeItem[]>;
  getWardrobeItem(userId: string, garmentId: string): Promise<WardrobeItem | undefined>;
  addWardrobeItem(item: WardrobeItem): Promise<WardrobeItem>;

  listLooks(userId: string): Promise<Look[]>;
  getLook(userId: string, lookId: string): Promise<Look | undefined>;
  /** Allocates the next "look-N" id for the user and persists. */
  addLook(input: Omit<Look, "id" | "createdAt">): Promise<Look>;

  addReaction(reaction: Reaction): Promise<Reaction>;
  listReactions(userId: string): Promise<Reaction[]>;

  getRenderJob(key: string): Promise<RenderJob | undefined>;
  upsertRenderJob(job: RenderJob): Promise<RenderJob>;
  setRenderStatus(
    key: string,
    status: RenderStatus,
    patch?: { url?: string; error?: string },
  ): Promise<void>;
}

export type { ReactionKind };
