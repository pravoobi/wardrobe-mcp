import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncClass } from "node:sqlite";

// Loaded via require so bundlers/test runners don't try to resolve the
// `node:sqlite` builtin at transform time (Vite strips the `node:` prefix).
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
import type { Store } from "./Store.js";
import type {
  AuthCode,
  Look,
  OAuthToken,
  Photo,
  Reaction,
  RenderJob,
  RenderStatus,
  User,
  WardrobeItem,
} from "./types.js";

/**
 * Dev / test store backed by the built-in `node:sqlite`. Single file, no native
 * build step. Not a single-table design (that constraint is DynamoDB's); here we
 * use plain relational tables and keep the `Store` contract identical.
 */
export class SqliteStore implements Store {
  private readonly db: InstanceType<typeof DatabaseSyncClass>;

  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        displayName TEXT NOT NULL,
        primaryPhotoId TEXT,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        s3Key TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        isPrimary INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS wardrobe (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        garmentId TEXT NOT NULL,
        source TEXT NOT NULL,
        addedAt TEXT NOT NULL,
        meta TEXT NOT NULL,
        UNIQUE (userId, garmentId)
      );
      CREATE TABLE IF NOT EXISTS looks (
        id TEXT NOT NULL,
        userId TEXT NOT NULL,
        garmentId TEXT NOT NULL,
        photoId TEXT NOT NULL,
        label TEXT,
        renderKey TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        PRIMARY KEY (userId, id)
      );
      CREATE TABLE IF NOT EXISTS reactions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        lookId TEXT NOT NULL,
        kind TEXT NOT NULL,
        note TEXT,
        at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS render_jobs (
        key TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        photoId TEXT NOT NULL,
        garmentId TEXT NOT NULL,
        status TEXT NOT NULL,
        url TEXT,
        error TEXT,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_codes (
        codeHash TEXT PRIMARY KEY,
        clientId TEXT NOT NULL,
        userId TEXT NOT NULL,
        scopes TEXT NOT NULL,
        redirectUri TEXT NOT NULL,
        codeChallenge TEXT NOT NULL,
        resource TEXT NOT NULL,
        expiresAt INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        tokenHash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        userId TEXT NOT NULL,
        scopes TEXT NOT NULL,
        clientId TEXT NOT NULL,
        resource TEXT NOT NULL,
        expiresAt INTEGER NOT NULL,
        refreshHash TEXT
      );
    `);
  }

  async getUser(userId: string): Promise<User | undefined> {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToUser(row) : undefined;
  }

  async upsertUser(user: User): Promise<User> {
    this.db
      .prepare(
        `INSERT INTO users (id, displayName, primaryPhotoId, createdAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           displayName = excluded.displayName,
           primaryPhotoId = excluded.primaryPhotoId`,
      )
      .run(user.id, user.displayName, user.primaryPhotoId ?? null, user.createdAt);
    return user;
  }

  async listPhotos(userId: string): Promise<Photo[]> {
    const rows = this.db
      .prepare("SELECT * FROM photos WHERE userId = ?")
      .all(userId) as Record<string, unknown>[];
    return rows.map(rowToPhoto);
  }

  async getPrimaryPhoto(userId: string): Promise<Photo | undefined> {
    const row = this.db
      .prepare("SELECT * FROM photos WHERE userId = ? ORDER BY isPrimary DESC LIMIT 1")
      .get(userId) as Record<string, unknown> | undefined;
    return row ? rowToPhoto(row) : undefined;
  }

  async addPhoto(photo: Photo): Promise<Photo> {
    if (photo.isPrimary) {
      this.db.prepare("UPDATE photos SET isPrimary = 0 WHERE userId = ?").run(photo.userId);
    }
    this.db
      .prepare(
        `INSERT INTO photos (id, userId, s3Key, width, height, isPrimary)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        photo.id,
        photo.userId,
        photo.s3Key,
        photo.width,
        photo.height,
        photo.isPrimary ? 1 : 0,
      );
    if (photo.isPrimary) {
      this.db
        .prepare("UPDATE users SET primaryPhotoId = ? WHERE id = ?")
        .run(photo.id, photo.userId);
    }
    return photo;
  }

  async listWardrobe(userId: string): Promise<WardrobeItem[]> {
    const rows = this.db
      .prepare("SELECT * FROM wardrobe WHERE userId = ? ORDER BY addedAt")
      .all(userId) as Record<string, unknown>[];
    return rows.map(rowToWardrobeItem);
  }

  async getWardrobeItem(
    userId: string,
    garmentId: string,
  ): Promise<WardrobeItem | undefined> {
    const row = this.db
      .prepare("SELECT * FROM wardrobe WHERE userId = ? AND garmentId = ?")
      .get(userId, garmentId) as Record<string, unknown> | undefined;
    return row ? rowToWardrobeItem(row) : undefined;
  }

  async addWardrobeItem(item: WardrobeItem): Promise<WardrobeItem> {
    this.db
      .prepare(
        `INSERT INTO wardrobe (id, userId, garmentId, source, addedAt, meta)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(userId, garmentId) DO NOTHING`,
      )
      .run(
        item.id,
        item.userId,
        item.garmentId,
        item.source,
        item.addedAt,
        JSON.stringify(item.meta),
      );
    return (await this.getWardrobeItem(item.userId, item.garmentId)) ?? item;
  }

  async listLooks(userId: string): Promise<Look[]> {
    const rows = this.db
      .prepare("SELECT * FROM looks WHERE userId = ? ORDER BY createdAt")
      .all(userId) as Record<string, unknown>[];
    return rows.map(rowToLook);
  }

  async getLook(userId: string, lookId: string): Promise<Look | undefined> {
    const row = this.db
      .prepare("SELECT * FROM looks WHERE userId = ? AND id = ?")
      .get(userId, lookId) as Record<string, unknown> | undefined;
    return row ? rowToLook(row) : undefined;
  }

  async addLook(input: Omit<Look, "id" | "createdAt">): Promise<Look> {
    const count = this.db
      .prepare("SELECT COUNT(*) AS n FROM looks WHERE userId = ?")
      .get(input.userId) as { n: number };
    const look: Look = {
      ...input,
      id: `look-${count.n + 1}`,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO looks (id, userId, garmentId, photoId, label, renderKey, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        look.id,
        look.userId,
        look.garmentId,
        look.photoId,
        look.label ?? null,
        look.renderKey,
        look.createdAt,
      );
    return look;
  }

  async addReaction(reaction: Reaction): Promise<Reaction> {
    this.db
      .prepare(
        `INSERT INTO reactions (id, userId, lookId, kind, note, at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reaction.id,
        reaction.userId,
        reaction.lookId,
        reaction.kind,
        reaction.note ?? null,
        reaction.at,
      );
    return reaction;
  }

  async listReactions(userId: string): Promise<Reaction[]> {
    const rows = this.db
      .prepare("SELECT * FROM reactions WHERE userId = ? ORDER BY at")
      .all(userId) as Record<string, unknown>[];
    return rows.map(rowToReaction);
  }

  async getRenderJob(key: string): Promise<RenderJob | undefined> {
    const row = this.db.prepare("SELECT * FROM render_jobs WHERE key = ?").get(key) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToRenderJob(row) : undefined;
  }

  async upsertRenderJob(job: RenderJob): Promise<RenderJob> {
    this.db
      .prepare(
        `INSERT INTO render_jobs (key, userId, photoId, garmentId, status, url, error, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           status = excluded.status,
           url = excluded.url,
           error = excluded.error,
           updatedAt = excluded.updatedAt`,
      )
      .run(
        job.key,
        job.userId,
        job.photoId,
        job.garmentId,
        job.status,
        job.url ?? null,
        job.error ?? null,
        job.updatedAt,
      );
    return job;
  }

  async setRenderStatus(
    key: string,
    status: RenderStatus,
    patch: { url?: string; error?: string } = {},
  ): Promise<void> {
    this.db
      .prepare(
        `UPDATE render_jobs
         SET status = ?, url = COALESCE(?, url), error = COALESCE(?, error), updatedAt = ?
         WHERE key = ?`,
      )
      .run(status, patch.url ?? null, patch.error ?? null, new Date().toISOString(), key);
  }

  async putAuthCode(code: AuthCode): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO auth_codes
           (codeHash, clientId, userId, scopes, redirectUri, codeChallenge, resource, expiresAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        code.codeHash,
        code.clientId,
        code.userId,
        JSON.stringify(code.scopes),
        code.redirectUri,
        code.codeChallenge,
        code.resource,
        code.expiresAt,
      );
  }

  async takeAuthCode(codeHash: string): Promise<AuthCode | undefined> {
    const row = this.db.prepare("SELECT * FROM auth_codes WHERE codeHash = ?").get(codeHash) as
      | Record<string, unknown>
      | undefined;
    this.db.prepare("DELETE FROM auth_codes WHERE codeHash = ?").run(codeHash);
    if (!row) return undefined;
    return {
      codeHash: String(row.codeHash),
      clientId: String(row.clientId),
      userId: String(row.userId),
      scopes: JSON.parse(String(row.scopes)) as string[],
      redirectUri: String(row.redirectUri),
      codeChallenge: String(row.codeChallenge),
      resource: String(row.resource),
      expiresAt: Number(row.expiresAt),
    };
  }

  async putToken(token: OAuthToken): Promise<void> {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO oauth_tokens
           (tokenHash, kind, userId, scopes, clientId, resource, expiresAt, refreshHash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token.tokenHash,
        token.kind,
        token.userId,
        JSON.stringify(token.scopes),
        token.clientId,
        token.resource,
        token.expiresAt,
        token.refreshHash ?? null,
      );
  }

  async getToken(tokenHash: string): Promise<OAuthToken | undefined> {
    const row = this.db.prepare("SELECT * FROM oauth_tokens WHERE tokenHash = ?").get(tokenHash) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      tokenHash: String(row.tokenHash),
      kind: row.kind === "refresh" ? "refresh" : "access",
      userId: String(row.userId),
      scopes: JSON.parse(String(row.scopes)) as string[],
      clientId: String(row.clientId),
      resource: String(row.resource),
      expiresAt: Number(row.expiresAt),
      refreshHash: row.refreshHash ? String(row.refreshHash) : undefined,
    };
  }

  async deleteToken(tokenHash: string): Promise<void> {
    this.db.prepare("DELETE FROM oauth_tokens WHERE tokenHash = ?").run(tokenHash);
  }

  async deleteTokensByRefresh(refreshHash: string): Promise<void> {
    this.db
      .prepare("DELETE FROM oauth_tokens WHERE tokenHash = ? OR refreshHash = ?")
      .run(refreshHash, refreshHash);
  }

  close(): void {
    this.db.close();
  }
}

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    displayName: String(r.displayName),
    primaryPhotoId: r.primaryPhotoId ? String(r.primaryPhotoId) : undefined,
    createdAt: String(r.createdAt),
  };
}

function rowToPhoto(r: Record<string, unknown>): Photo {
  return {
    id: String(r.id),
    userId: String(r.userId),
    s3Key: String(r.s3Key),
    width: Number(r.width),
    height: Number(r.height),
    isPrimary: Number(r.isPrimary) === 1,
  };
}

function rowToWardrobeItem(r: Record<string, unknown>): WardrobeItem {
  return {
    id: String(r.id),
    userId: String(r.userId),
    garmentId: String(r.garmentId),
    source: r.source === "upload" ? "upload" : "catalog",
    addedAt: String(r.addedAt),
    meta: JSON.parse(String(r.meta)) as WardrobeItem["meta"],
  };
}

function rowToLook(r: Record<string, unknown>): Look {
  return {
    id: String(r.id),
    userId: String(r.userId),
    garmentId: String(r.garmentId),
    photoId: String(r.photoId),
    label: r.label ? String(r.label) : undefined,
    renderKey: String(r.renderKey),
    createdAt: String(r.createdAt),
  };
}

function rowToReaction(r: Record<string, unknown>): Reaction {
  return {
    id: String(r.id),
    userId: String(r.userId),
    lookId: String(r.lookId),
    kind: r.kind as Reaction["kind"],
    note: r.note ? String(r.note) : undefined,
    at: String(r.at),
  };
}

function rowToRenderJob(r: Record<string, unknown>): RenderJob {
  return {
    key: String(r.key),
    userId: String(r.userId),
    photoId: String(r.photoId),
    garmentId: String(r.garmentId),
    status: r.status as RenderJob["status"],
    url: r.url ? String(r.url) : undefined,
    error: r.error ? String(r.error) : undefined,
    updatedAt: String(r.updatedAt),
  };
}
