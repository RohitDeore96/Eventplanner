import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLIENT_TIMEOUT_MS, aiClient } from '../../src/lib/aiClient';

/**
 * Client contract for the /api routes (Phase 3 §5.3): replies carry an honest `source`,
 * every reply is schema-validated before the UI sees it, server error bodies surface their
 * message, anything else becomes a REQUEST_FAILED_<status> error, a newer call to the SAME
 * endpoint cancels the stale one (but never another endpoint's in-flight call), and the
 * client outwaits the route's own 40 s patience so the server's verdict wins the race.
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

/** Hanging fetch that records which absolute path was aborted through its signal. */
function hangingFetchTrackingAborts(): { fetch: ReturnType<typeof vi.fn>; abortedPaths: string[] } {
  const abortedPaths: string[] = [];
  const fetch = vi.fn(
    (path: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          abortedPaths.push(path);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );
  return { fetch, abortedPaths };
}

const validIdeas = {
  themes: ['Marigold evening'],
  activities: ['Sangeet night'],
  foodStyle: ['Live chaat counter'],
  personalTouches: ['Family playlist'],
};

const validIntake = {
  name: null,
  occasion: 'wedding',
  dateISO: null,
  guests: 200,
  budgetMinor: 80_000_000,
  notes: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('aiClient', () => {
  it('returns the parsed body with the server-provided source', async () => {
    const fetchMock = fetchReturning({ ...validIdeas, source: 'cache' });
    vi.stubGlobal('fetch', fetchMock);
    const reply = await aiClient.ideas('wedding', 'traditional', 120);
    expect(reply.body.themes).toEqual(['Marigold evening']);
    expect(reply.source).toBe('cache');
    const [path, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/suggest-ideas');
    expect(JSON.parse(init.body)).toMatchObject({ occasion: 'wedding', guests: 120 });
  });

  it('rejects a schema-invalid reply with AI_REPLY_INVALID instead of passing it to the UI', async () => {
    // Missing three of the four idea arrays — a shape the routes can never produce.
    vi.stubGlobal('fetch', fetchReturning({ themes: ['x'], source: 'gemini-x' }));
    await expect(aiClient.ideas('wedding', 'fun', 80)).rejects.toThrow('AI_REPLY_INVALID');
  });

  it('rejects a 200 reply that carries no source (not a Utsav answer)', async () => {
    vi.stubGlobal('fetch', fetchReturning(validIdeas));
    await expect(aiClient.ideas('wedding', 'fun', 80)).rejects.toThrow('AI_REPLY_INVALID');
  });

  it('surfaces the server error message when the error body is well-formed', async () => {
    vi.stubGlobal('fetch', fetchReturning({ error: 'Rate limit reached' }, false, 429));
    await expect(aiClient.ask('How much is unpaid?', '{}')).rejects.toThrow('Rate limit reached');
  });

  it('falls back to REQUEST_FAILED_<status> for a non-JSON error body', async () => {
    vi.stubGlobal('fetch', fetchReturning({ unexpected: true }, false, 503));
    await expect(aiClient.review('{}')).rejects.toThrow('REQUEST_FAILED_503');
  });

  it('aborts the previous in-flight call when a newer one hits the same endpoint', async () => {
    vi.stubGlobal('fetch', fetchHangingUntilAbort());
    const stale = aiClient.parseIntake('wedding', 'INR');
    const staleRejection = expect(stale).rejects.toThrow(/abort/i);
    // Starting a newer call to the SAME endpoint replaces — and therefore aborts — the stale one.
    aiClient.parseIntake('second event', 'INR').catch(() => undefined);
    await staleRejection;
    // Retire the now-hanging second call with one that settles immediately.
    vi.stubGlobal('fetch', fetchReturning({ ...validIntake, source: 'cache' }));
    await aiClient.parseIntake('third event', 'INR');
  });

  it('never aborts another endpoint in-flight call when a different panel calls', async () => {
    const { fetch, abortedPaths } = hangingFetchTrackingAborts();
    vi.stubGlobal('fetch', fetch);
    const reviewCall = aiClient.review('facts');
    reviewCall.catch(() => undefined);
    // The Assistant view runs ask beside review; starting ask must not kill review.
    const askCall = aiClient.ask('Any conflicts?', 'facts');
    askCall.catch(() => undefined);
    await Promise.resolve();
    await Promise.resolve();
    expect(abortedPaths).toEqual([]);
    // The two calls are still pending; settle them via the timeout-free path.
    vi.stubGlobal('fetch', fetchReturning({ ...validIdeas, source: 'built-in' }));
    await aiClient.ideas('wedding', 'fun', 80).catch(() => undefined);
  });

  it('aborts a request only at the client timeout, above the route 40 s patience', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', fetchHangingUntilAbort());
    const pending = aiClient.ask('Any conflicts?', '{}');
    const rejection = expect(pending).rejects.toThrow(/abort/i);
    // Regression: the old 16 s timeout aborted live answers the server was still
    // producing (recorded round-trips took up to 41 s). Nothing may abort before the
    // route's own 40 s patience has elapsed.
    await vi.advanceTimersByTimeAsync(40_000);
    const stillPending = await Promise.race([
      pending.then(
        () => 'settled',
        () => 'settled',
      ),
      Promise.resolve('pending'),
    ]);
    expect(stillPending).toBe('pending');
    expect(CLIENT_TIMEOUT_MS).toBeGreaterThan(40_000);
    await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS - 40_000);
    await rejection;
  });

  it('omits absent idea-context keys and drops empty free-text', async () => {
    const fetchMock = fetchReturning({ ...validIdeas, source: 'built-in' });
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
    const fetchMock = fetchReturning({ ...validIdeas, source: 'built-in' });
    vi.stubGlobal('fetch', fetchMock);
    await aiClient.ideas('birthday', 'playful', 40);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(init.body)).toEqual({ occasion: 'birthday', vibe: 'playful', guests: 40 });
  });
});
