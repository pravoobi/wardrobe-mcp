import type {
  AuthCode,
  Look,
  OAuthToken,
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
  /** `renderSalt` is store-generated, never caller-supplied — see Photo. */
  addPhoto(photo: Omit<Photo, "renderSalt">): Promise<Photo>;

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

  // --- OAuth 2.1 authorization server state ---
  putAuthCode(code: AuthCode): Promise<void>;
  /** Atomically fetch-and-delete: an authorization code is single-use. */
  takeAuthCode(codeHash: string): Promise<AuthCode | undefined>;

  putToken(token: OAuthToken): Promise<void>;
  getToken(tokenHash: string): Promise<OAuthToken | undefined>;
  deleteToken(tokenHash: string): Promise<void>;
  /** Revoke an access token and its sibling on refresh rotation / logout. */
  deleteTokensByRefresh(refreshHash: string): Promise<void>;
}

export type { ReactionKind };
