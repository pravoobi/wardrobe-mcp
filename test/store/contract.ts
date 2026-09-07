import { expect, it } from "vitest";
import type { Store } from "../../src/store/Store.js";

/**
 * The `Store` contract. Run against every implementation so `sqlite` and
 * `dynamodb` stay behaviourally identical. Call inside a `describe`.
 */
export function storeContract(getStore: () => Store): void {
  const iso = () => new Date().toISOString();

  it("users: upsert is idempotent and preserves createdAt", async () => {
    const s = getStore();
    const created = "2020-01-01T00:00:00.000Z";
    await s.upsertUser({ id: "u1", displayName: "One", createdAt: created });
    await s.upsertUser({ id: "u1", displayName: "One Renamed", createdAt: iso() });
    const u = await s.getUser("u1");
    expect(u?.displayName).toBe("One Renamed");
    expect(u?.createdAt).toBe(created);
    expect(await s.getUser("missing")).toBeUndefined();
  });

  it("photos: adding a primary demotes the previous primary", async () => {
    const s = getStore();
    await s.upsertUser({ id: "u2", displayName: "Two", createdAt: iso() });
    await s.addPhoto({ id: "p1", userId: "u2", s3Key: "a", width: 1, height: 2, isPrimary: true });
    await s.addPhoto({ id: "p2", userId: "u2", s3Key: "b", width: 1, height: 2, isPrimary: true });
    const primary = await s.getPrimaryPhoto("u2");
    expect(primary?.id).toBe("p2");
    expect((await s.listPhotos("u2")).length).toBe(2);
    expect((await s.getUser("u2"))?.primaryPhotoId).toBe("p2");
  });

  // Regression: SQLite's addPhoto used a plain INSERT with no conflict
  // handling, so re-running `npm run seed` against an already-seeded database
  // (the exact first thing a new contributor following the README does twice)
  // crashed with a raw UNIQUE constraint error. DynamoDB's PutItem always
  // overwrites, so the two backends silently disagreed until this was added.
  it("photos: adding the same id twice upserts instead of throwing", async () => {
    const s = getStore();
    await s.upsertUser({ id: "u2b", displayName: "Two B", createdAt: iso() });
    await s.addPhoto({ id: "p1", userId: "u2b", s3Key: "a", width: 1, height: 2, isPrimary: true });
    await expect(
      s.addPhoto({ id: "p1", userId: "u2b", s3Key: "a-reseeded", width: 3, height: 4, isPrimary: true }),
    ).resolves.not.toThrow();
    const photos = await s.listPhotos("u2b");
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ s3Key: "a-reseeded", width: 3, height: 4 });
  });

  it("wardrobe: add is idempotent per (user, garment)", async () => {
    const s = getStore();
    await s.upsertUser({ id: "u3", displayName: "Three", createdAt: iso() });
    const item = {
      id: "w1",
      userId: "u3",
      garmentId: "dress-navy-floral-01",
      source: "catalog" as const,
      addedAt: iso(),
      meta: { name: "Navy", color: "navy", occasion: ["party"], category: "dress" },
    };
    await s.addWardrobeItem(item);
    await s.addWardrobeItem({ ...item, id: "w2" });
    const list = await s.listWardrobe("u3");
    expect(list.length).toBe(1);
    expect(list[0]?.garmentId).toBe("dress-navy-floral-01");
    expect(await s.getWardrobeItem("u3", "dress-navy-floral-01")).toBeDefined();
  });

  it("looks: ids are sequential per user", async () => {
    const s = getStore();
    await s.upsertUser({ id: "u4", displayName: "Four", createdAt: iso() });
    const a = await s.addLook({ userId: "u4", garmentId: "g1", photoId: "p", renderKey: "k1" });
    const b = await s.addLook({ userId: "u4", garmentId: "g2", photoId: "p", renderKey: "k2", label: "two" });
    expect([a.id, b.id]).toEqual(["look-1", "look-2"]);
    expect((await s.getLook("u4", "look-2"))?.label).toBe("two");
    expect((await s.listLooks("u4")).map((l) => l.id)).toEqual(["look-1", "look-2"]);
  });

  it("reactions: append and list", async () => {
    const s = getStore();
    await s.upsertUser({ id: "u5", displayName: "Five", createdAt: iso() });
    await s.addReaction({ id: "r1", userId: "u5", lookId: "look-1", kind: "love", at: iso() });
    const rs = await s.listReactions("u5");
    expect(rs.length).toBe(1);
    expect(rs[0]?.kind).toBe("love");
  });

  it("render jobs: upsert then status transitions", async () => {
    const s = getStore();
    await s.upsertRenderJob({
      key: "rk1",
      userId: "u6",
      photoId: "p",
      garmentId: "g",
      status: "queued",
      updatedAt: iso(),
    });
    await s.setRenderStatus("rk1", "running");
    await s.setRenderStatus("rk1", "done", { url: "https://cdn/x.webp" });
    const job = await s.getRenderJob("rk1");
    expect(job?.status).toBe("done");
    expect(job?.url).toBe("https://cdn/x.webp");
    expect(await s.getRenderJob("nope")).toBeUndefined();
  });

  it("auth codes: single-use", async () => {
    const s = getStore();
    const code = {
      codeHash: "h1",
      clientId: "c",
      userId: "u",
      scopes: ["wardrobe:read"],
      redirectUri: "http://localhost",
      codeChallenge: "cc",
      resource: "http://localhost:3000/mcp",
      expiresAt: Date.now() + 60_000,
    };
    await s.putAuthCode(code);
    expect((await s.takeAuthCode("h1"))?.userId).toBe("u");
    expect(await s.takeAuthCode("h1")).toBeUndefined();
  });

  it("tokens: get / delete / deleteTokensByRefresh removes the pair", async () => {
    const s = getStore();
    const base = {
      userId: "u",
      scopes: ["wardrobe:read"],
      clientId: "c",
      resource: "http://localhost:3000/mcp",
      expiresAt: Date.now() + 60_000,
    };
    await s.putToken({ ...base, tokenHash: "refresh-h", kind: "refresh" });
    await s.putToken({ ...base, tokenHash: "access-h", kind: "access", refreshHash: "refresh-h" });
    expect((await s.getToken("access-h"))?.kind).toBe("access");

    await s.deleteTokensByRefresh("refresh-h");
    expect(await s.getToken("access-h")).toBeUndefined();
    expect(await s.getToken("refresh-h")).toBeUndefined();
  });
}
