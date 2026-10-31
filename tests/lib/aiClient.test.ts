import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiClient } from '../../src/lib/aiClient';

/**
 * Client contract for the /api routes (Phase 3 §5.3): typed replies carry an honest
 * `source`, server error bodies surface their message, anything else becomes a
 * REQUEST_FAILED_<status> error, and a newer call cancels the stale one.
 */

function fetchReturning(payload: unknown, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const response = { ok, status, json: () => Promise.resolve(payload) };
  return vi.fn(() => Promise.resolve(response));
}

function fetchHangingUntilAbort(): ReturnType<typeof vi.fn> {
  return vi.fn(
    (_path: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('aiClient', () => {
  it('returns the parsed body with the server-provided source', async () => {
    const fetchMock = fetchReturning({ ideas: [], source: 'cache' });
    vi.stubGlobal('fetch', fetchMock);
    const reply = await aiClient.ideas('wedding', 'traditional', 120);
    expect(reply.body).toEqual({ ideas: [], source: 'cache' });
    expect(reply.source).toBe('cache');
    const [path, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/suggest-ideas');
    expect(JSON.parse(init.body)).toMatchObject({ occasion: 'wedding', guests: 120 });
  });

  it('labels a body without a source field as unknown instead of guessing', async () => {
    vi.stubGlobal('fetch', fetchReturning({ ideas: [] }));
    const reply = await aiClient.ideas('wedding', 'fun', 80);
    expect(reply.source).toBe('unknown');
  });

  it('surfaces the server error message when the error body is well-formed', async () => {
    vi.stubGlobal('fetch', fetchReturning({ error: 'Rate limit reached' }, false, 429));
    await expect(aiClient.ask('How much is unpaid?', '{}')).rejects.toThrow('Rate limit reached');
  });

  it('falls back to REQUEST_FAILED_<status> for a non-JSON error body', async () => {
    vi.stubGlobal('fetch', fetchReturning({ unexpected: true }, false, 503));
    await expect(aiClient.review('{}')).rejects.toThrow('REQUEST_FAILED_503');
  });

  it('aborts the previous in-flight call when a newer one starts', async () => {
    vi.stubGlobal('fetch', fetchHangingUntilAbort());
    const stale = aiClient.parseIntake('wedding', 'INR');
    const staleRejection = expect(stale).rejects.toThrow(/abort/i);
    // Starting a newer call replaces — and therefore aborts — the stale one.
    aiClient.parseIntake('second event', 'INR').catch(() => undefined);
    await staleRejection;
    // Retire the now-hanging second call with one that settles immediately.
    vi.stubGlobal('fetch', fetchReturning({ parsed: { ok: true }, source: 'cache' }));
    await aiClient.parseIntake('third event', 'INR');
  });

  it('aborts a request that exceeds the 16-second timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchHangingUntilAbort());
    const pending = aiClient.ask('Any conflicts?', '{}');
    const rejection = expect(pending).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(16_000);
    await rejection;
  });

  it('omits absent idea-context keys and drops empty free-text', async () => {
    const fetchMock = fetchReturning({ ideas: [], source: 'built-in' });
    vi.stubGlobal('fetch', fetchMock);
    await aiClient.ideas('wedding', 'elegant', 200, {
      notes: '',
      mustHaves: 'Live band and sangeet choreography',
      formality: 'formal',
      budgetMinor: 1_200_000_00,
      remainingBudgetMinor: 400_000_00,
      bookedVendors: 2,
    });
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).toMatchObject({
      occasion: 'wedding',
      vibe: 'elegant',
      guests: 200,
      formality: 'formal',
      budgetMinor: 1_200_000_00,
      remainingBudgetMinor: 400_000_00,
      bookedVendors: 2,
    });
    expect(body).not.toHaveProperty('notes');
    expect(body).not.toHaveProperty('budgetTier');
    expect(body.mustHaves).toBe('Live band and sangeet choreography');
  });

  it('sends no context keys at all when none are given', async () => {
    const fetchMock = fetchReturning({ ideas: [], source: 'built-in' });
    vi.stubGlobal('fetch', fetchMock);
    await aiClient.ideas('birthday', 'playful', 40);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ occasion: 'birthday', vibe: 'playful', guests: 40 });
  });
});
