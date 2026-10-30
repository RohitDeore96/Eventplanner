import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiRequest, ApiResponse } from '../../api/_lib/http';

/**
 * Route tests run the REAL handlers. Two modes:
 * - No GEMINI_API_KEY: the deterministic fallback must answer (AI-down is a first-class path).
 * - Mocked SDK: proves JSON-mode parsing, zod validation, caching and input sensitivity.
 */

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<void>;

function mockRes(): ApiResponse & { json: () => { status: number; body: unknown } } {
  const state = { status: 0, body: undefined as unknown };
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(text?: string) {
      state.body = text === undefined ? state.body : JSON.parse(text);
      state.status = this.statusCode;
    },
    json() {
      return { status: state.status, body: state.body };
    },
    on: () => res,
    once: () => res,
    destroy: () => res,
    socket: { remoteAddress: '10.0.0.1' },
  };
  return res as unknown as ApiResponse & { json: () => { status: number; body: unknown } };
}

function mockReq(body: unknown, overrides: Record<string, unknown> = {}): ApiRequest {
  const headerOverrides = ('headers' in overrides ? overrides.headers : {}) as Record<
    string,
    unknown
  >;
  const rest = 'headers' in overrides ? {} : overrides;
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://utsav.example',
      host: 'utsav.example',
      'x-forwarded-for': '10.9.9.9',
      ...headerOverrides,
    },
    on(event: string, cb: () => void) {
      if (event === 'end') cb();
      return this;
    },
    once() {
      return this;
    },
    destroy() {
      return this;
    },
    socket: { remoteAddress: '10.9.9.9' },
    body,
    ...rest,
  } as unknown as ApiRequest;
}

import parseIntakeHandler from '../../api/parse-intake';
import extractQuoteHandler from '../../api/extract-quote';
import proposePatchHandler from '../../api/propose-patch';
import suggestIdeasHandler from '../../api/suggest-ideas';

function load(name: 'parse-intake' | 'extract-quote' | 'propose-patch' | 'suggest-ideas'): Handler {
  const registry: Record<string, Handler> = {
    'parse-intake': parseIntakeHandler,
    'extract-quote': extractQuoteHandler,
    'propose-patch': proposePatchHandler,
    'suggest-ideas': suggestIdeasHandler,
  };
  const handler = registry[name];
  if (handler === undefined) throw new Error(`no handler registered for ${name}`);
  return handler;
}

const originalEnv = { ...process.env };

describe('API routes: guards', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  it('rejects GET with 405', async () => {
    const handler = load('parse-intake');
    const req = mockReq({ text: 'x' }, { method: 'GET' });
    const res = mockRes();
    await handler(req, res);
    expect(res.json()).toMatchObject({ status: 405, body: { error: 'METHOD_NOT_ALLOWED' } });
  });

  it('rejects cross-site origins with 403 so other sites cannot spend the quota', async () => {
    const handler = load('parse-intake');
    const res = mockRes();
    await handler(mockReq({ text: 'x' }, { headers: { origin: 'https://evil.example' } }), res);
    expect(res.json()).toMatchObject({ status: 403 });
  });

  it('rejects wrong content types with 415', async () => {
    const handler = load('parse-intake');
    const res = mockRes();
    await handler(mockReq({ text: 'x' }, { headers: { 'content-type': 'text/plain' } }), res);
    expect(res.json()).toMatchObject({ status: 415 });
  });

  it('rejects invalid JSON with 400 and oversized text with schema failure 400', async () => {
    const handler = load('parse-intake');
    const res1 = mockRes();
    await handler(mockReq(undefined), res1);
    expect(res1.json()).toMatchObject({ status: 400 });
    const res2 = mockRes();
    await handler(mockReq({ text: 'x'.repeat(2000) }), res2);
    expect(res2.json()).toMatchObject({ status: 400 });
  });

  it('rate limits the same IP after 20 requests with 429', async () => {
    const handler = load('suggest-ideas');
    let last = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = mockRes();
      await handler(
        mockReq(
          { occasion: 'wedding', vibe: 'pastel', guests: 120 },
          { headers: { 'x-forwarded-for': '10.5.5.5' } },
        ),
        res,
      );
      last = res.json().status;
    }
    expect(last).toBe(429);
  });

  it('falls back to the built-in planner when no key is set (AI-down path)', async () => {
    const handler = load('parse-intake');
    const res = mockRes();
    await handler(mockReq({ text: 'Shaadi in Pune, 200 guests, 8 lakh budget' }), res);
    const { status, body } = res.json();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      occasion: 'wedding',
      guests: 200,
      budgetMinor: 800_000,
      source: 'built-in',
    });
  });

  it('extract-quote fallback keeps everything null instead of inventing data', async () => {
    const handler = load('extract-quote');
    const res = mockRes();
    await handler(mockReq({ text: 'Some quote text' }), res);
    const { status, body } = res.json();
    expect(status).toBe(200);
    expect(body).toMatchObject({ totalPriceMinor: null, source: 'built-in' });
  });

  it('propose-patch has no fallback: without a key it returns 503 AI_UNAVAILABLE', async () => {
    const handler = load('propose-patch');
    const res = mockRes();
    await handler(
      mockReq({ instruction: 'add tasks', facts: 'Budget: ok', today: '2026-10-30' }),
      res,
    );
    expect(res.json()).toMatchObject({ status: 503, body: { error: 'AI_UNAVAILABLE' } });
  });
});

describe('API routes: with a mocked Gemini', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.GEMINI_API_KEY = 'test-key';
    vi.resetModules();
    vi.doMock('@google/genai', () => {
      const calls: string[] = [];
      return {
        GoogleGenAI: class {
          models = {
            generateContent: async (options: { contents: string }): Promise<{ text: string }> => {
              await Promise.resolve();
              calls.push(options.contents);
              const counter = globalThis as { __geminiCalls?: number };
              counter.__geminiCalls = (counter.__geminiCalls ?? 0) + 1;
              // The mock changes its answer with the input: proves input sensitivity.
              const guests = /Guests:\s*(\d+)/.exec(options.contents)?.[1] ?? '0';
              return {
                text: JSON.stringify({
                  themes: [`Theme for ${guests} guests`],
                  activities: ['Games'],
                  foodStyle: ['Thali'],
                  personalTouches: ['Photo wall'],
                }),
              };
            },
          };
        },
      };
    });
  });

  it('parses JSON-mode output, validates it and labels the model', async () => {
    const mod = await import('../../api/suggest-ideas');
    const handler = mod.default;
    const res = mockRes();
    await handler(mockReq({ occasion: 'wedding', vibe: 'pastel', guests: 120 }), res);
    const { status, body } = res.json();
    expect(status).toBe(200);
    expect(body).toMatchObject({ themes: ['Theme for 120 guests'], source: 'gemini-3.6-flash' });
  });

  it('caches identical requests: the model is called once for two identical bodies', async () => {
    const mod = await import('../../api/suggest-ideas');
    const handler = mod.default;
    const first = mockRes();
    await handler(mockReq({ occasion: 'birthday', vibe: 'cricket', guests: 40 }), first);
    const callsAfterFirst = (globalThis as { __geminiCalls?: number }).__geminiCalls ?? 0;
    const second = mockRes();
    await handler(mockReq({ occasion: 'birthday', vibe: 'cricket', guests: 40 }), second);
    const callsAfterSecond = (globalThis as { __geminiCalls?: number }).__geminiCalls ?? 0;
    expect(second.json().status).toBe(200);
    const firstBody = first.json().body as Record<string, unknown>;
    const secondBody = second.json().body as Record<string, unknown>;
    expect(secondBody).toMatchObject({ ...firstBody, source: 'cache' });
    expect(callsAfterSecond).toBe(callsAfterFirst);
  });

  it('changing inputs changes outputs (input-sensitivity proof)', async () => {
    const mod = await import('../../api/suggest-ideas');
    const handler = mod.default;
    const small = mockRes();
    await handler(mockReq({ occasion: 'wedding', vibe: 'pastel', guests: 30 }), small);
    const big = mockRes();
    await handler(mockReq({ occasion: 'wedding', vibe: 'pastel', guests: 300 }), big);
    const smallBody = small.json().body as { themes: string[] };
    const bigBody = big.json().body as { themes: string[] };
    expect(smallBody.themes[0]).not.toBe(bigBody.themes[0]);
  });

  it('falls back when the model returns invalid JSON, and still answers 200', async () => {
    vi.doMock('@google/genai', () => ({
      GoogleGenAI: class {
        models = {
          generateContent: async (): Promise<{ text: string }> => {
            await Promise.resolve();
            return { text: 'not json at all' };
          },
        };
      },
    }));
    vi.resetModules();
    const mod = await import('../../api/suggest-ideas');
    const handler = mod.default;
    const res = mockRes();
    await handler(mockReq({ occasion: 'wedding', vibe: 'pastel', guests: 10 }), res);
    const { status, body } = res.json();
    expect(status).toBe(200);
    expect(body).toMatchObject({ source: 'built-in' });
  });
});
