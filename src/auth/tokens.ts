import { createHash, randomBytes } from "node:crypto";
import type { UserContext } from "../mcp/context.js";

interface TokenRecord {
  userId: string;
  scopes: string[];
  expiresAt: number;
}

/**
 * In-memory token store. Access tokens are opaque; only their SHA-256 is kept.
 * Phase 3 swaps this for store-backed hashed tokens + refresh grant. Dev tokens
 * of the form `dev_<userId>` are always accepted so the smoke flow needs no
 * OAuth dance.
 */
class TokenStore {
  private readonly access = new Map<string, TokenRecord>();

  issueAccess(userId: string, scopes: string[], ttlSeconds = 15 * 60): string {
    const token = `wat_${randomBytes(24).toString("base64url")}`;
    this.access.set(hash(token), { userId, scopes, expiresAt: Date.now() + ttlSeconds * 1000 });
    return token;
  }

  resolve(token: string): UserContext | undefined {
    if (token.startsWith("dev_")) {
      const userId = token.slice(4);
      if (userId) return { userId, scopes: ["wardrobe:read", "wardrobe:write"] };
    }
    const rec = this.access.get(hash(token));
    if (!rec) return undefined;
    if (rec.expiresAt < Date.now()) {
      this.access.delete(hash(token));
      return undefined;
    }
    return { userId: rec.userId, scopes: rec.scopes };
  }
}

const hash = (t: string): string => createHash("sha256").update(t).digest("hex");

export const tokenStore = new TokenStore();
