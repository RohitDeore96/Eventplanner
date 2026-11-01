import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import '../../src/schemas/zodRuntime.js';
import { clientIp, isRateLimited, pruneBuckets } from './rateLimit.js';

/**
 * Route plumbing shared by every endpoint: method allow-list, content-type, same-origin,
 * body-size cap, schema validation, per-IP rate limit (rateLimit.ts), timeout and safe
 * errors. Handlers stay thin: guard, validate, run, validate, respond. Run failures are
 * mapped through the typed `ApiError` / `runErrorResponse` seam below, so external
 * response shapes never depend on message strings surviving a refactor.
 */

const BODY_LIMIT_BYTES = 8 * 1024;
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
 * A typed internal failure: a layer throws this instead of encoding the outcome in a
 * bare message string, and the guard maps it straight to its safe external response.
 * Adopted at the guard seam first; the AI layer's plain-Error codes keep working through
 * `runErrorResponse`'s legacy branch, so adoption can proceed one throw site at a time.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Maps a thrown run failure to the response the client may see. Pure and unit-tested.
 * A typed `ApiError` passes through; plain-Error message codes from the AI layer keep
 * their exact legacy status/code; anything unknown stays a bare 500 INTERNAL_ERROR.
 * No message text, stack, provider detail or user data ever reaches the client.
 */
export function runErrorResponse(error: unknown): { status: number; code: string } {
  if (error instanceof ApiError) return { status: error.status, code: error.code };
  const message = error instanceof Error ? error.message : '';
  const legacyCodes: readonly (readonly [string, number, string])[] = [
    ['AI_DAILY_CAP', 429, 'AI_DAILY_CAP'],
    ['AI_UNAVAILABLE', 503, 'AI_UNAVAILABLE'],
    ['AI_RESPONSE_INVALID', 502, 'AI_RESPONSE_INVALID'],
  ];
  for (const [marker, status, code] of legacyCodes) {
    if (message === marker) return { status, code };
  }
  if (message.startsWith('AI_HTTP_')) return { status: 502, code: 'AI_UPSTREAM' };
  return { status: 500, code: 'INTERNAL_ERROR' };
}

/** Maps typed failures from the AI layer to safe status codes. Never leaks user text. */
function sendRunError(res: ApiResponse, error: unknown): void {
  const { status, code } = runErrorResponse(error);
  sendError(res, status, code);
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

/**
 * JSON body media type check. The media type alone decides, before any parameter
 * (RFC 9110: types are case-insensitive, parameters are legitimate), so
 * `application/json; charset=utf-8` is accepted while lookalikes such as
 * `application/jsonp`, `application/json5` or a bare `text/plain` are not — a substring
 * test would wave all of those through or depend on the client's letter casing.
 */
export function isJsonContentType(header: string | undefined): boolean {
  if (header === undefined) return false;
  const mediaType = header.split(';')[0]?.trim().toLowerCase() ?? '';
  return mediaType === 'application/json';
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
    if (!isJsonContentType(contentType)) {
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
