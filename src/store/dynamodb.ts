import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
  BatchWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { randomBytes } from "node:crypto";
import { config } from "../config.js";
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
 * Production store — single DynamoDB table, `PK` + `SK`.
 *
 *   USER#<id>        PROFILE                 user
 *   USER#<id>        PHOTO#<photoId>         photo
 *   USER#<id>        WARDROBE#<garmentId>    wardrobe item
 *   USER#<id>        LOOK#look-N             saved look
 *   USER#<id>        REACTION#<at>#<id>      reaction
 *   RENDER#<key>     JOB                     render job (keyed by cache key alone)
 *   AUTHCODE#<hash>  CODE                    OAuth code   (ttl)
 *   TOKEN#<hash>     TOKEN                   OAuth token  (ttl)   GSI1PK = REFRESH#<refreshHash>
 *
 * GSI1 (`GSI1PK`) groups an OAuth refresh token with the access tokens it
 * minted, so rotation/logout is one query + batch delete.
 */
export class DynamoDBStore implements Store {
  private readonly doc: DynamoDBDocumentClient;
  private readonly raw: DynamoDBClient;
  private readonly table = config.dynamoTable;

  constructor() {
    this.raw = new DynamoDBClient({
      region: config.awsRegion,
      ...(config.dynamoEndpoint ? { endpoint: config.dynamoEndpoint } : {}),
    });
    this.doc = DynamoDBDocumentClient.from(this.raw, {
      marshallOptions: { removeUndefinedValues: true },
    });
  }

  /** Create the table + enable TTL if missing. Used by tests and `scripts/`. */
  async ensureTable(): Promise<void> {
    const client = this.raw;
    try {
      await client.send(new DescribeTableCommand({ TableName: this.table }));
      return;
    } catch {
      /* create below */
    }
    await client.send(
      new CreateTableCommand({
        TableName: this.table,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
          { AttributeName: "PK", AttributeType: "S" },
          { AttributeName: "SK", AttributeType: "S" },
          { AttributeName: "GSI1PK", AttributeType: "S" },
        ],
        KeySchema: [
          { AttributeName: "PK", KeyType: "HASH" },
          { AttributeName: "SK", KeyType: "RANGE" },
        ],
        GlobalSecondaryIndexes: [
          {
            IndexName: "GSI1",
            KeySchema: [{ AttributeName: "GSI1PK", KeyType: "HASH" }],
            Projection: { ProjectionType: "KEYS_ONLY" },
          },
        ],
      }),
    );
    for (let i = 0; i < 30; i++) {
      const d = await client.send(new DescribeTableCommand({ TableName: this.table }));
      if (d.Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await client
      .send(
        new UpdateTimeToLiveCommand({
          TableName: this.table,
          TimeToLiveSpecification: { Enabled: true, AttributeName: "ttl" },
        }),
      )
      .catch(() => undefined);
  }

  private async get<T>(PK: string, SK: string): Promise<T | undefined> {
    const r = await this.doc.send(new GetCommand({ TableName: this.table, Key: { PK, SK } }));
    return r.Item as T | undefined;
  }

  private async put(item: Record<string, unknown>): Promise<void> {
    await this.doc.send(new PutCommand({ TableName: this.table, Item: item }));
  }

  private async queryByPk(PK: string, skPrefix?: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await this.doc.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: skPrefix ? "PK = :pk AND begins_with(SK, :sk)" : "PK = :pk",
          ExpressionAttributeValues: skPrefix ? { ":pk": PK, ":sk": skPrefix } : { ":pk": PK },
          ExclusiveStartKey,
        }),
      );
      out.push(...((r.Items as Record<string, unknown>[]) ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
    return out;
  }

  // ---------- users ----------
  async getUser(userId: string): Promise<User | undefined> {
    const it = await this.get<Record<string, unknown>>(`USER#${userId}`, "PROFILE");
    return it ? { id: userId, displayName: String(it.displayName), primaryPhotoId: it.primaryPhotoId as string | undefined, createdAt: String(it.createdAt) } : undefined;
  }

  async upsertUser(user: User): Promise<User> {
    const existing = await this.getUser(user.id);
    await this.put({
      PK: `USER#${user.id}`,
      SK: "PROFILE",
      displayName: user.displayName,
      primaryPhotoId: user.primaryPhotoId ?? existing?.primaryPhotoId,
      createdAt: existing?.createdAt ?? user.createdAt,
    });
    return (await this.getUser(user.id))!;
  }

  // ---------- photos ----------
  async listPhotos(userId: string): Promise<Photo[]> {
    const rows = await this.queryByPk(`USER#${userId}`, "PHOTO#");
    return rows.map((r) => rowPhoto(userId, r));
  }

  async getPrimaryPhoto(userId: string): Promise<Photo | undefined> {
    const photos = await this.listPhotos(userId);
    return photos.find((p) => p.isPrimary) ?? photos[0];
  }

  async addPhoto(photo: Omit<Photo, "renderSalt">): Promise<Photo> {
    if (photo.isPrimary) {
      for (const p of await this.listPhotos(photo.userId)) {
        if (p.isPrimary) {
          await this.doc.send(
            new UpdateCommand({
              TableName: this.table,
              Key: { PK: `USER#${photo.userId}`, SK: `PHOTO#${p.id}` },
              UpdateExpression: "SET isPrimary = :f",
              ExpressionAttributeValues: { ":f": false },
            }),
          );
        }
      }
    }
    // Preserve the existing renderSalt on a re-seed/re-upload of the same
    // photo id, so previously-cached renders stay valid instead of silently
    // orphaning under an old (now-unreachable) cache key.
    const existing = await this.doc.send(
      new GetCommand({ TableName: this.table, Key: { PK: `USER#${photo.userId}`, SK: `PHOTO#${photo.id}` } }),
    );
    const renderSalt = (existing.Item?.renderSalt as string | undefined) ?? randomBytes(16).toString("hex");
    await this.put({
      PK: `USER#${photo.userId}`,
      SK: `PHOTO#${photo.id}`,
      photoId: photo.id,
      s3Key: photo.s3Key,
      width: photo.width,
      height: photo.height,
      isPrimary: photo.isPrimary,
      renderSalt,
    });
    if (photo.isPrimary) {
      await this.doc.send(
        new UpdateCommand({
          TableName: this.table,
          Key: { PK: `USER#${photo.userId}`, SK: "PROFILE" },
          UpdateExpression: "SET primaryPhotoId = :p",
          ExpressionAttributeValues: { ":p": photo.id },
        }),
      );
    }
    return { ...photo, renderSalt };
  }

  // ---------- wardrobe ----------
  async listWardrobe(userId: string): Promise<WardrobeItem[]> {
    const rows = await this.queryByPk(`USER#${userId}`, "WARDROBE#");
    return rows
      .map((r) => rowWardrobe(userId, r))
      .sort((a, b) => a.addedAt.localeCompare(b.addedAt));
  }

  async getWardrobeItem(userId: string, garmentId: string): Promise<WardrobeItem | undefined> {
    const it = await this.get<Record<string, unknown>>(`USER#${userId}`, `WARDROBE#${garmentId}`);
    return it ? rowWardrobe(userId, it) : undefined;
  }

  async addWardrobeItem(item: WardrobeItem): Promise<WardrobeItem> {
    const existing = await this.getWardrobeItem(item.userId, item.garmentId);
    if (existing) return existing;
    await this.put({
      PK: `USER#${item.userId}`,
      SK: `WARDROBE#${item.garmentId}`,
      id: item.id,
      garmentId: item.garmentId,
      source: item.source,
      addedAt: item.addedAt,
      meta: item.meta,
    });
    return item;
  }

  // ---------- looks ----------
  async listLooks(userId: string): Promise<Look[]> {
    const rows = await this.queryByPk(`USER#${userId}`, "LOOK#");
    return rows.map((r) => rowLook(userId, r)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getLook(userId: string, lookId: string): Promise<Look | undefined> {
    const it = await this.get<Record<string, unknown>>(`USER#${userId}`, `LOOK#${lookId}`);
    return it ? rowLook(userId, it) : undefined;
  }

  async addLook(input: Omit<Look, "id" | "createdAt">): Promise<Look> {
    const seq = await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `USER#${input.userId}`, SK: "LOOKSEQ" },
        UpdateExpression: "ADD seq :one",
        ExpressionAttributeValues: { ":one": 1 },
        ReturnValues: "UPDATED_NEW",
      }),
    );
    const n = Number((seq.Attributes as { seq?: number } | undefined)?.seq ?? 1);
    const look: Look = { ...input, id: `look-${n}`, createdAt: new Date().toISOString() };
    await this.put({
      PK: `USER#${input.userId}`,
      SK: `LOOK#${look.id}`,
      lookId: look.id,
      garmentId: look.garmentId,
      photoId: look.photoId,
      label: look.label,
      renderKey: look.renderKey,
      createdAt: look.createdAt,
    });
    return look;
  }

  // ---------- reactions ----------
  async addReaction(reaction: Reaction): Promise<Reaction> {
    await this.put({
      PK: `USER#${reaction.userId}`,
      SK: `REACTION#${reaction.at}#${reaction.id}`,
      id: reaction.id,
      lookId: reaction.lookId,
      kind: reaction.kind,
      note: reaction.note,
      at: reaction.at,
    });
    return reaction;
  }

  async listReactions(userId: string): Promise<Reaction[]> {
    const rows = await this.queryByPk(`USER#${userId}`, "REACTION#");
    return rows.map((r) => ({
      id: String(r.id),
      userId,
      lookId: String(r.lookId),
      kind: r.kind as Reaction["kind"],
      note: r.note as string | undefined,
      at: String(r.at),
    }));
  }

  // ---------- render jobs ----------
  async getRenderJob(key: string): Promise<RenderJob | undefined> {
    const it = await this.get<Record<string, unknown>>(`RENDER#${key}`, "JOB");
    return it ? rowRenderJob(it) : undefined;
  }

  async upsertRenderJob(job: RenderJob): Promise<RenderJob> {
    await this.put({
      PK: `RENDER#${job.key}`,
      SK: "JOB",
      key: job.key,
      userId: job.userId,
      photoId: job.photoId,
      garmentId: job.garmentId,
      status: job.status,
      url: job.url,
      error: job.error,
      updatedAt: job.updatedAt,
    });
    return job;
  }

  async setRenderStatus(
    key: string,
    status: RenderStatus,
    patch: { url?: string; error?: string } = {},
  ): Promise<void> {
    const sets = ["#s = :s", "updatedAt = :u"];
    const names: Record<string, string> = { "#s": "status" };
    const values: Record<string, unknown> = { ":s": status, ":u": new Date().toISOString() };
    if (patch.url !== undefined) {
      sets.push("#url = :url");
      names["#url"] = "url";
      values[":url"] = patch.url;
    }
    if (patch.error !== undefined) {
      sets.push("#e = :e");
      names["#e"] = "error";
      values[":e"] = patch.error;
    }
    await this.doc.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { PK: `RENDER#${key}`, SK: "JOB" },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
  }

  // ---------- OAuth ----------
  async putAuthCode(code: AuthCode): Promise<void> {
    await this.put({
      PK: `AUTHCODE#${code.codeHash}`,
      SK: "CODE",
      ...code,
      ttl: Math.ceil(code.expiresAt / 1000) + 60,
    });
  }

  async takeAuthCode(codeHash: string): Promise<AuthCode | undefined> {
    const r = await this.doc.send(
      new DeleteCommand({
        TableName: this.table,
        Key: { PK: `AUTHCODE#${codeHash}`, SK: "CODE" },
        ReturnValues: "ALL_OLD",
      }),
    );
    const it = r.Attributes as (AuthCode & Record<string, unknown>) | undefined;
    if (!it) return undefined;
    return {
      codeHash: it.codeHash,
      clientId: it.clientId,
      userId: it.userId,
      scopes: it.scopes,
      redirectUri: it.redirectUri,
      codeChallenge: it.codeChallenge,
      resource: it.resource,
      expiresAt: it.expiresAt,
    };
  }

  async putToken(token: OAuthToken): Promise<void> {
    await this.put({
      PK: `TOKEN#${token.tokenHash}`,
      SK: "TOKEN",
      ...token,
      GSI1PK: `REFRESH#${token.kind === "refresh" ? token.tokenHash : token.refreshHash ?? token.tokenHash}`,
      ttl: Math.ceil(token.expiresAt / 1000) + 60,
    });
  }

  async getToken(tokenHash: string): Promise<OAuthToken | undefined> {
    const it = await this.get<OAuthToken & Record<string, unknown>>(`TOKEN#${tokenHash}`, "TOKEN");
    if (!it) return undefined;
    return {
      tokenHash: it.tokenHash,
      kind: it.kind,
      userId: it.userId,
      scopes: it.scopes,
      clientId: it.clientId,
      resource: it.resource,
      expiresAt: it.expiresAt,
      refreshHash: it.refreshHash,
    };
  }

  async deleteToken(tokenHash: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.table, Key: { PK: `TOKEN#${tokenHash}`, SK: "TOKEN" } }),
    );
  }

  async deleteTokensByRefresh(refreshHash: string): Promise<void> {
    const r = await this.doc.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: "GSI1",
        KeyConditionExpression: "GSI1PK = :g",
        ExpressionAttributeValues: { ":g": `REFRESH#${refreshHash}` },
      }),
    );
    const keys = ((r.Items as Record<string, unknown>[]) ?? []).map((it) => ({
      DeleteRequest: { Key: { PK: it.PK, SK: it.SK } },
    }));
    for (let i = 0; i < keys.length; i += 25) {
      await this.doc.send(
        new BatchWriteCommand({ RequestItems: { [this.table]: keys.slice(i, i + 25) } }),
      );
    }
  }
}

function rowPhoto(userId: string, r: Record<string, unknown>): Photo {
  return {
    id: String(r.photoId),
    userId,
    s3Key: String(r.s3Key),
    width: Number(r.width),
    height: Number(r.height),
    isPrimary: Boolean(r.isPrimary),
    renderSalt: String(r.renderSalt ?? ""),
  };
}

function rowWardrobe(userId: string, r: Record<string, unknown>): WardrobeItem {
  return {
    id: String(r.id),
    userId,
    garmentId: String(r.garmentId),
    source: r.source === "upload" ? "upload" : "catalog",
    addedAt: String(r.addedAt),
    meta: r.meta as WardrobeItem["meta"],
  };
}

function rowLook(userId: string, r: Record<string, unknown>): Look {
  return {
    id: String(r.lookId),
    userId,
    garmentId: String(r.garmentId),
    photoId: String(r.photoId),
    label: r.label as string | undefined,
    renderKey: String(r.renderKey),
    createdAt: String(r.createdAt),
  };
}

function rowRenderJob(r: Record<string, unknown>): RenderJob {
  return {
    key: String(r.key),
    userId: String(r.userId),
    photoId: String(r.photoId),
    garmentId: String(r.garmentId),
    status: r.status as RenderJob["status"],
    url: r.url as string | undefined,
    error: r.error as string | undefined,
    updatedAt: String(r.updatedAt),
  };
}
