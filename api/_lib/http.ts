import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';

/**
 * Route plumbing shared by every endpoint: method allow-list, content-type, same-origin,
 * body-size cap, schema validation, per-IP rate limit, timeout and safe errors.
 * Handlers stay thin: guard, validate, run, validate, respond.
 */

const BODY_LIMIT_BYTES = 8 * 1024;
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const AI_TIMEOUT_MS = 15_000;

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

function sendJson(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function sendError(res: ApiResponse, status: number, code: string): void {
  sendJson(res, status, { error: code });
}

function sameOrigin(req: ApiRequest): boolean {
  const origin = req.headers.origin;
  if (origin === undefined) return true; // same-origin fetches may omit Origin in some runtimes
  const host = req.headers.host;
  if (typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
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
    if (isRateLimited(clientIp(req), Date.now())) {
      sendError(res, 429, 'RATE_LIMITED');
      return;
    }
    const raw = await readRawBody(req);
    if (raw === null || raw.length > BODY_LIMIT_BYTES) {
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
    if (error instanceof Error && error.name === 'AbortError') {
      sendError(res, 504, 'AI_TIMEOUT');
      return;
    }
    sendRunError(res, error);
  } finally {
    clearTimeout(timer);
  }
}
