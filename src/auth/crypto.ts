import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque token: URL-safe, ~32 bytes of entropy, prefixed so logs are greppable. */
export function opaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** base64url( SHA-256( verifier ) ), per RFC 7636 §4.6. */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const expected = Buffer.from(pkceS256(verifier));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
