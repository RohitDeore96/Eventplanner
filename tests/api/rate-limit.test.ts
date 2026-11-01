import { describe, expect, it } from 'vitest';
import { isRateLimited, pruneBuckets } from '../../api/_lib/rateLimit';

/**
 * Direct guards for the extracted per-IP rate limiter: the 20-requests-per-5-minutes
 * sliding window, window expiry, and the bounded bucket map under IP rotation.
 */

const WINDOW = 5 * 60 * 1000;

describe('rate limiter', () => {
  it('allows the first 20 requests in a window and blocks the 21st', () => {
    const now = 1_000_000;
    for (let i = 0; i < 20; i += 1) {
      expect(isRateLimited('10.0.0.1', now + i)).toBe(false);
    }
    expect(isRateLimited('10.0.0.1', now + 999)).toBe(true);
    // A different IP has its own bucket.
    expect(isRateLimited('10.0.0.2', now)).toBe(false);
  });

  it('frees the IP once its window slides out', () => {
    const start = 2_000_000;
    for (let i = 0; i < 20; i += 1) isRateLimited('10.0.1.1', start + i);
    expect(isRateLimited('10.0.1.1', start + WINDOW - 1)).toBe(true);
    expect(isRateLimited('10.0.1.1', start + WINDOW + 5)).toBe(false);
  });

  it('keeps the bucket map bounded when attacker IPs rotate', () => {
    // Fill far beyond the 5000-bucket cap with distinct IPs.
    for (let i = 0; i < 5_100; i += 1) {
      isRateLimited(`10.1.${Math.floor(i / 250)}.${i % 250}`, 3_000_000 + i);
    }
    // pruneBuckets only acts when full; after pruning there must be room again.
    pruneBuckets(3_000_000 + 5_100);
    expect(isRateLimited('10.9.9.9', 3_000_000 + 5_101)).toBe(false);
  });
});
