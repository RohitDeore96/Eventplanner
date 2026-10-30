import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  allocateByWeights,
  currencyExponent,
  formatMoney,
  isValidMinor,
  parseMajorAmount,
  sumMinor,
} from '../../src/engine/money';
import { MAX_AMOUNT_MINOR } from '../../src/config/limits';

describe('currencyExponent', () => {
  it('knows zero, two and three decimal currencies', () => {
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('INR')).toBe(2);
    expect(currencyExponent('KWD')).toBe(3);
  });
  it('rejects unknown, lowercase and malformed codes', () => {
    for (const bad of ['', 'usd', 'US', 'USDX', 'ZZZ', '12$', '<script>']) {
      expect(currencyExponent(bad)).toBeNull();
    }
  });
});

describe('parseMajorAmount', () => {
  it.each([
    ['1250.50', 'INR', 125050],
    ['0', 'USD', 0],
    ['1000', 'JPY', 1000],
    ['  12.5 ', 'USD', 1250],
    ['0.001', 'KWD', 1],
  ])('parses %s %s', (input, currency, expected) => {
    expect(parseMajorAmount(input, currency)).toBe(expected);
  });
  it.each([
    ['-5', 'USD'],
    ['1,000', 'USD'],
    ['1.234', 'USD'],
    ['1.5', 'JPY'],
    ['abc', 'USD'],
    ['', 'USD'],
    ['1e5', 'USD'],
    ['10', 'NOPE'],
    ['99999999999999999', 'USD'],
    ['10000000000.01', 'USD'],
  ])('rejects %s %s', (input, currency) => {
    expect(parseMajorAmount(input, currency)).toBeNull();
  });
  it('accepts exactly the maximum', () => {
    expect(parseMajorAmount('10000000000.00', 'USD')).toBe(MAX_AMOUNT_MINOR);
  });
});

describe('formatMoney', () => {
  it('formats two- and zero-decimal currencies', () => {
    expect(formatMoney(125050, 'USD', 'en-US')).toBe('$1,250.50');
    expect(formatMoney(1000, 'JPY', 'ja-JP')).toMatch(/1,000/);
    expect(formatMoney(100_000_00, 'INR', 'en-IN')).toContain('1,00,000.00');
  });
  it('falls back to English for an invalid locale tag', () => {
    expect(formatMoney(500, 'USD', 'not a locale!!')).toBe('$5.00');
  });
  it('falls back to the raw number for an unknown currency', () => {
    expect(formatMoney(500, 'NOPE', 'en')).toBe('500');
  });
});

describe('isValidMinor', () => {
  it('accepts integers in range only', () => {
    expect(isValidMinor(0)).toBe(true);
    expect(isValidMinor(MAX_AMOUNT_MINOR)).toBe(true);
    for (const bad of [-1, 1.5, MAX_AMOUNT_MINOR + 1, Number.NaN, Infinity, '5', null]) {
      expect(isValidMinor(bad)).toBe(false);
    }
  });
});

describe('allocateByWeights', () => {
  it('splits a classic remainder case exactly', () => {
    expect(allocateByWeights(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocateByWeights(10, [1, 1, 1])).toEqual([4, 3, 3]);
  });
  it('gives remainder to the largest fractional share, lowest index on ties', () => {
    expect(allocateByWeights(10, [1, 2])).toEqual([3, 7]);
    expect(allocateByWeights(5, [0, 1, 1])).toEqual([0, 3, 2]);
  });
  it('breaks remainder ties by lowest index across many equal shares', () => {
    expect(allocateByWeights(10, [1, 1, 1, 1, 1, 1, 1])).toEqual([2, 2, 2, 1, 1, 1, 1]);
    expect(allocateByWeights(7, [1, 1, 1, 1, 1])).toEqual([2, 2, 1, 1, 1]);
    expect(allocateByWeights(6, [1, 1, 1, 1])).toEqual([2, 2, 1, 1]);
  });
  it('ranks by fractional remainder, not by weight size', () => {
    expect(allocateByWeights(4, [3, 2])).toEqual([2, 2]);
    expect(allocateByWeights(7, [5, 3, 2])).toEqual([4, 2, 1]);
  });
  it('rejects a negative weight even when the weights still sum above zero', () => {
    expect(allocateByWeights(100, [3, -1])).toBeNull();
  });
  it('returns zeros for a zero total and null for unusable weights', () => {
    expect(allocateByWeights(0, [1, 2])).toEqual([0, 0]);
    expect(allocateByWeights(100, [])).toBeNull();
    expect(allocateByWeights(100, [0, 0])).toBeNull();
    expect(allocateByWeights(100, [1, -1])).toBeNull();
    expect(allocateByWeights(100, [1, 0.5])).toBeNull();
    expect(allocateByWeights(-1, [1])).toBeNull();
    expect(allocateByWeights(MAX_AMOUNT_MINOR + 1, [1])).toBeNull();
  });
  it('does not overflow at the maximum amount with large weights', () => {
    const parts = allocateByWeights(MAX_AMOUNT_MINOR, [9_999_999, 1, 3_000_000_000]);
    expect(parts).not.toBeNull();
    expect(sumMinor(parts ?? [])).toBe(MAX_AMOUNT_MINOR);
  });

  it('property: parts always sum to the total', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_AMOUNT_MINOR }),
        fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 30 }),
        (total, weights) => {
          const parts = allocateByWeights(total, weights);
          if (weights.every((w) => w === 0)) return parts === null;
          return parts !== null && sumMinor(parts) === total;
        },
      ),
    );
  });
  it('property: each part is within one unit of its exact share and zero weights get zero', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          const parts = allocateByWeights(total, weights);
          if (parts === null) return true;
          const sum = weights.reduce((a, b) => a + b, 0);
          return parts.every((part, i) => {
            const weight = weights[i] ?? 0;
            const exact = (total * weight) / sum;
            return Math.abs(part - exact) < 1 && (weight !== 0 || part === 0);
          });
        },
      ),
    );
  });
});
