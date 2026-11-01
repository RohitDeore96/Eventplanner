import type { ApiRequest } from './http.js';

/**
 * Per-instance, best-effort rate limiting: a sliding window per client IP, with a bounded
 * bucket map so an attacker rotating spoofed IPs cannot grow instance memory without
 * limit. A shared store can replace this later; the behaviour contract is covered by
 * direct unit tests.
 */

const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
/** Upper bound on tracked IPs per instance: memory stays bounded even under IP spoofing. */
const MAX_IP_BUCKETS = 5_000;

const buckets = new Map<string, RateState>();

interface RateState {
  readonly hits: number[];
}

export function clientIp(req: ApiRequest): string {
  // `x-vercel-forwarded-for` is injected by the platform from the real connection and
  // cannot be written by the client; a client-supplied `x-forwarded-for` is prepended to
  // the platform value on Vercel, so its leftmost entry is attacker-chosen. It is only
  // read where no platform header exists (the local dev bridge), where spoofing is
  // irrelevant; the socket address is the last resort.
  const vercel = req.headers['x-vercel-forwarded-for'];
  if (typeof vercel === 'string' && vercel.length > 0) {
    return vercel.split(',')[0]?.trim() ?? 'unknown';
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.socket.remoteAddress ?? 'unknown';
}

export function isRateLimited(ip: string, now: number): boolean {
  const bucket = buckets.get(ip) ?? { hits: [] };
  const fresh = bucket.hits.filter((time) => now - time < RATE_LIMIT_WINDOW_MS);
  if (fresh.length >= RATE_LIMIT_REQUESTS) {
    buckets.set(ip, { hits: fresh });
    return true;
  }
  fresh.push(now);
  buckets.set(ip, { hits: fresh });
  return false;
}

/**
 * Keeps the bucket map bounded: an attacker rotating spoofed IPs must not grow instance
 * memory without limit. Runs only when the map is full (amortised O(1) per request):
 * first drop expired windows, then evict the oldest-inserted buckets until there is room.
 */
export function pruneBuckets(now: number): void {
  if (buckets.size < MAX_IP_BUCKETS) return;
  for (const [ip, bucket] of buckets) {
    if (bucket.hits.every((time) => now - time >= RATE_LIMIT_WINDOW_MS)) buckets.delete(ip);
    if (buckets.size < MAX_IP_BUCKETS) return;
  }
  for (const ip of buckets.keys()) {
    buckets.delete(ip);
    if (buckets.size < MAX_IP_BUCKETS) return;
  }
}
