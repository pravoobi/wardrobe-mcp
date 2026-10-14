import type { Context, MiddlewareHandler } from "hono";

/**
 * Minimal in-process rate limiter — fixed window, keyed by client IP. No
 * external store: this runs as a single App Runner instance (min/max 1 today),
 * so a per-process Map is the right amount of complexity. If this ever scales
 * to multiple instances, each would enforce its own window independently
 * (a looser effective limit, not a broken one) until replaced with something
 * shared (e.g. DynamoDB-backed or a real rate-limit service).
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }): MiddlewareHandler {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return async (c: Context, next) => {
    const key = clientIp(c);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + opts.windowMs });
    } else {
      entry.count += 1;
      if (entry.count > opts.max) {
        const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
        c.header("Retry-After", String(retryAfter));
        return c.json(
          { error: "rate_limited", error_description: `Too many requests to ${opts.name}. Try again shortly.` },
          429,
        );
      }
    }

    // Lazily evict expired entries so the map doesn't grow unbounded — cheap
    // at this traffic scale, no need for a sweep interval/timer.
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }

    await next();
  };
}

function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming;
  return incoming?.socket?.remoteAddress ?? "unknown";
}
