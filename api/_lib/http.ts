import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import '../../src/schemas/zodRuntime.js';

/**
 * Route plumbing shared by every endpoint: method allow-list, content-type, same-origin,
 * body-size cap, schema validation, per-IP rate limit, timeout and safe errors.
 * Handlers stay thin: guard, validate, run, validate, respond.
 */

const BODY_LIMIT_BYTES = 8 * 1024;
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
/** Upper bound on tracked IPs per instance: memory stays bounded even under IP spoofing. */
const MAX_IP_BUCKETS = 5_000;
/**
 * Patience for one live model answer (chain attempts included). Keep this within the
 * deployment's Vercel function duration: vercel.json pins maxDuration 60 for the api
 * functions, so the route's own graceful 504 AI_TIMEOUT always fires before the
 * platform would kill the function. Live chain failover (e.g. a 429/503 model pair
 * before a lite model answers) needs this headroom on free-tier keys.
 */
const AI_TIMEOUT_MS = 40_000;

export type ApiRequest = IncomingMessage & { body?: unknown };
export type ApiResponse = ServerResponse;

export interface RouteConfig<T> {
  /** Unique route name, used for error codes and cache keys. */
  readonly name: string;
  readonly schema: z.ZodType<T>;
  /** Produces the response body. Receives the validated input and a signal for timeouts. */
  readonly run: (input: T, context: RunContext) => Promise<unknown>;
}

interface RunContext {
  readonly signal: AbortSignal;
}

/** Per-instance, best-effort rate limit; a shared store can replace this later. */
const buckets = new Map<string, RateState>();

interface RateState {
  readonly hits: number[];
}

function clientIp(req: ApiRequest): string {
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

function isRateLimited(ip: string, now: number): boolean {
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
function pruneBuckets(now: number): void {
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

function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(res: ApiResponse, status: number, code: string): void {
  sendJson(res, status, { error: code });
}

/**
 * Same-origin policy, tuned to how browsers actually behave:
 * - Every browser attaches `Origin` to a POST (same-origin included), so a present Origin
 *   must match the Host — and, when the platform reports the scheme, its protocol too.
 * - A POST *without* Origin is not a browser cross-site request (browsers cannot suppress
 *   it), so the deciding signal is `Sec-Fetch-Site`, which browsers always send and
 *   scripts cannot forge: 'cross-site'/'same-site' without an Origin is rejected, while a
 *   request with neither header is non-browser tooling (the local dev bridge, the owner's
 *   live smoke test) and cannot be the victim of CSRF. CSRF-relevant browsers are fully
 *   covered by the first rule; deterministic validation and rate limits stay the real
 *   boundary for everything else.
 */
function sameOrigin(req: ApiRequest): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) {
    const fetchSite = req.headers['sec-fetch-site'];
    return fetchSite !== 'cross-site' && fetchSite !== 'same-site';
  }
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.host !== host) return false;
  // Behind the platform proxy the real scheme arrives in `x-forwarded-proto`; an origin
  // that downgrades it (http:// on an https site) is not a legitimate browser request.
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.length > 0) {
    return parsed.protocol === `${proto.split(',')[0]?.trim() ?? 'https'}:`;
  }
  return true;
}

function readBody(req: ApiRequest): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Builds a guarded handler. Everything the platform could inject arrives untrusted, so
 * each step fails closed. Logic under `run` is fully unit-testable with a mocked model.
 */
function readRawBody(req: ApiRequest): Promise<string | null> {
  return req.body === undefined
    ? readBody(req)
    : Promise.resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
}

/** Maps typed failures from the AI layer to safe status codes. Never leaks user text. */
function sendRunError(res: ApiResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : '';
  const status =
    message === 'AI_DAILY_CAP'
      ? 429
      : message === 'AI_UNAVAILABLE'
        ? 503
        : message === 'AI_RESPONSE_INVALID'
          ? 502
          : message.startsWith('AI_HTTP_')
            ? 502
            : 500;
  const code =
    status === 429
      ? 'AI_DAILY_CAP'
      : status === 503
        ? 'AI_UNAVAILABLE'
        : status === 502
          ? message.startsWith('AI_HTTP_')
            ? 'AI_UPSTREAM'
            : 'AI_RESPONSE_INVALID'
          : 'INTERNAL_ERROR';
  sendError(res, status, code);
}

export function createHandler<T>(config: RouteConfig<T>) {
  return async function handler(req: ApiRequest, res: ApiResponse): Promise<void> {
    if (req.method !== 'POST') {
      sendError(res, 405, 'METHOD_NOT_ALLOWED');
      return;
    }
    if (!sameOrigin(req)) {
      sendError(res, 403, 'FORBIDDEN_ORIGIN');
      return;
    }
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
      sendError(res, 415, 'UNSUPPORTED_MEDIA_TYPE');
      return;
    }
    const now = Date.now();
    pruneBuckets(now);
    if (isRateLimited(clientIp(req), now)) {
      sendError(res, 429, 'RATE_LIMITED');
      return;
    }
    const raw = await readRawBody(req);
    // The limit is a BYTE limit: `raw.length` would count UTF-16 code units, so a body of
    // multibyte characters (emoji, Devanagari, CJK) could nearly quadruple its way past
    // the cap. Buffer.byteLength measures the real UTF-8 size, for string bodies and for
    // serialized object bodies alike (both arrive here as a string).
    if (raw === null || Buffer.byteLength(raw, 'utf8') > BODY_LIMIT_BYTES) {
      sendError(res, 413, 'BODY_TOO_LARGE');
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      sendError(res, 400, 'INVALID_JSON');
      return;
    }
    const parsed = config.schema.safeParse(parsedJson);
    if (!parsed.success) {
      sendError(res, 400, 'INVALID_INPUT');
      return;
    }
    await runGuarded(config, parsed.data, res);
  };
}

async function runGuarded<T>(config: RouteConfig<T>, input: T, res: ApiResponse): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_TIMEOUT_MS);
  try {
    const body = await config.run(input, { signal: controller.signal });
    sendJson(res, 200, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if ((error instanceof Error && error.name === 'AbortError') || message === 'AI_TIMEOUT') {
      sendError(res, 504, 'AI_TIMEOUT');
      return;
    }
    sendRunError(res, error);
  } finally {
    clearTimeout(timer);
  }
}
