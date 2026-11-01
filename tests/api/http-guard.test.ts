import { describe, expect, it } from 'vitest';
import type { ApiRequest, ApiResponse } from '../../api/_lib/http';
import { isJsonContentType } from '../../api/_lib/mediaType';
import { ApiError, createHandler, runErrorResponse } from '../../api/_lib/http';
import { z } from 'zod';

/**
 * Stage-2 API robustness: the JSON content-type gate must accept `application/json` with
 * legitimate parameters (charset) and reject missing, malformed or lookalike media types,
 * and run failures must map to the SAME safe external responses whether a layer throws a
 * typed ApiError or one of the AI layer's legacy message codes. Nothing here changes any
 * visible status, code or shape — these tests pin the contract.
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

function mockReq(headers: Record<string, string | undefined>): ApiRequest {
  return {
    method: 'POST',
    headers: {
      origin: 'https://utsav.example',
      host: 'utsav.example',
      'x-forwarded-for': '10.8.8.8',
      ...headers,
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
    socket: { remoteAddress: '10.8.8.8' },
    body: { text: 'x' },
  } as unknown as ApiRequest;
}

/** A minimal route: same guard plumbing as production, no provider dependency. */
const handler: Handler = createHandler({
  name: 'guard-probe',
  schema: z.object({ text: z.string() }),
  run: () => Promise.resolve({ ok: true }),
});

describe('isJsonContentType', () => {
  it.each([
    ['application/json', true],
    ['application/json; charset=utf-8', true],
    ['APPLICATION/JSON', true],
    ['Application/JSON ;charset="utf-8"', true],
    ['application/json;charset=UTF-8', true],
    ['application/json; charset="utf-8"; foo=bar', true],
    ['application/json;charset="a=b"', true],
  ])('accepts %j', (header, expected) => {
    expect(isJsonContentType(header)).toBe(expected);
  });

  it.each([
    undefined,
    '',
    'text/plain',
    'application/jsonp',
    'application/json5',
    'application/jsonx',
    'application/xml',
    'not-a-media-type',
    'text application/json',
    // Malformed parameters fail closed: empty segments, nameless/empty values,
    // non-token names, duplicated names and unterminated quoted strings.
    'application/json;',
    'application/json;;charset=utf-8',
    'application/json; =utf-8',
    'application/json; charset',
    'application/json; charset=',
    'application/json; char set=utf-8',
    'application/json; charset=utf-8; charset=utf-16',
    'application/json; charset="utf-8',
  ])('rejects %j', (header) => {
    expect(isJsonContentType(header)).toBe(false);
  });
});

describe('guard: content-type gate', () => {
  it('accepts application/json with parameters and answers from run', async () => {
    const res = mockRes();
    await handler(mockReq({ 'content-type': 'application/json; charset=utf-8' }), res);
    expect(res.json()).toMatchObject({ status: 200, body: { ok: true } });
  });

  it('rejects a missing content type with 415', async () => {
    const res = mockRes();
    await handler(mockReq({ 'content-type': undefined }), res);
    expect(res.json()).toMatchObject({ status: 415, body: { error: 'UNSUPPORTED_MEDIA_TYPE' } });
  });

  it.each([
    'text/plain',
    'application/jsonp',
    'not-a-media-type',
    'application/json; charset=',
    'application/json; charset',
  ])('rejects %s with 415', async (header) => {
    const res = mockRes();
    await handler(mockReq({ 'content-type': header }), res);
    expect(res.json()).toMatchObject({ status: 415, body: { error: 'UNSUPPORTED_MEDIA_TYPE' } });
  });

  it('still answers a charset-parameter request through the full guard chain', async () => {
    const res = mockRes();
    await handler(
      mockReq({
        'content-type': 'application/json;charset=UTF-8',
        origin: 'https://utsav.example',
      }),
      res,
    );
    expect(res.json()).toMatchObject({ status: 200, body: { ok: true } });
  });
});

describe('runErrorResponse: the typed seam keeps every legacy response', () => {
  it('passes a typed ApiError straight through', () => {
    expect(runErrorResponse(new ApiError(409, 'PLAN_CONFLICT'))).toEqual({
      status: 409,
      code: 'PLAN_CONFLICT',
    });
  });

  it('keeps the AI layer message codes on their exact legacy responses', () => {
    expect(runErrorResponse(new Error('AI_DAILY_CAP'))).toEqual({
      status: 429,
      code: 'AI_DAILY_CAP',
    });
    expect(runErrorResponse(new Error('AI_UNAVAILABLE'))).toEqual({
      status: 503,
      code: 'AI_UNAVAILABLE',
    });
    expect(runErrorResponse(new Error('AI_RESPONSE_INVALID'))).toEqual({
      status: 502,
      code: 'AI_RESPONSE_INVALID',
    });
    expect(runErrorResponse(new Error('AI_HTTP_503'))).toEqual({
      status: 502,
      code: 'AI_UPSTREAM',
    });
  });

  it('answers a bare 500 for unknown, non-Error and empty failures — nothing leaks', () => {
    for (const failure of [new Error('disk on fire'), 'a string', 42, null, undefined]) {
      expect(runErrorResponse(failure)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
    }
  });

  it('maps a thrown ApiError through the real handler', async () => {
    const throwing: Handler = createHandler({
      name: 'typed-probe',
      schema: z.object({ text: z.string() }),
      run: () => Promise.reject(new ApiError(429, 'AI_DAILY_CAP')),
    });
    const res = mockRes();
    await throwing(mockReq({ 'content-type': 'application/json' }), res);
    expect(res.json()).toMatchObject({ status: 429, body: { error: 'AI_DAILY_CAP' } });
  });

  it('maps a legacy plain-Error throw through the real handler unchanged', async () => {
    const throwing: Handler = createHandler({
      name: 'legacy-probe',
      schema: z.object({ text: z.string() }),
      run: () => Promise.reject(new Error('AI_HTTP_429')),
    });
    const res = mockRes();
    await throwing(mockReq({ 'content-type': 'application/json' }), res);
    expect(res.json()).toMatchObject({ status: 502, body: { error: 'AI_UPSTREAM' } });
  });
});
