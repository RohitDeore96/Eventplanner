import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPlan, DEFAULT_SPLITS } from '../../src/engine/create';
import { sumMinor } from '../../src/engine/money';
import type { Occasion } from '../../src/engine/types';
import { BASE_INPUT, TODAY } from '../helpers';

const OCCASIONS: Occasion[] = ['wedding', 'birthday', 'community'];

describe('DEFAULT_SPLITS', () => {
  it.each(OCCASIONS)(
    '%s splits sum to exactly 10,000 bps and include contingency and catering',
    (occasion) => {
      const rows = DEFAULT_SPLITS[occasion];
      expect(rows.reduce((a, r) => a + r.bps, 0)).toBe(10_000);
      expect(rows.some((r) => r.key === 'contingency')).toBe(true);
      expect(rows.some((r) => r.key === 'catering')).toBe(true);
    },
  );
});

describe('createPlan', () => {
  it('builds a plan whose category plans sum to the budget exactly', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OCCASIONS),
        fc.integer({ min: 1, max: 1_000_000_000_000 }),
        (occasion, budgetMinor) => {
          const result = createPlan({ ...BASE_INPUT, occasion, budgetMinor }, TODAY);
          return (
            result.ok &&
            sumMinor(result.value.plan.categories.map((c) => c.plannedMinor)) === budgetMinor
          );
        },
      ),
    );
  });

  it('works for zero-decimal currencies and stores integers only', () => {
    const result = createPlan(
      { ...BASE_INPUT, currency: 'JPY', locale: 'ja-JP', budgetMinor: 3_000_001 },
      TODAY,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.categories.every((c) => Number.isInteger(c.plannedMinor))).toBe(
        true,
      );
    }
  });

  it('trims the name and generates ordered tasks', () => {
    const result = createPlan({ ...BASE_INPUT, name: '  My Event  ' }, TODAY);
    expect(result.ok && result.value.plan.name).toBe('My Event');
    expect(result.ok && result.value.plan.tasks.length).toBeGreaterThan(4);
  });

  it('accepts a same-day event and compresses everything onto today', () => {
    const result = createPlan({ ...BASE_INPUT, dateISO: TODAY }, TODAY);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plan.tasks.every((t) => t.dueISO === TODAY)).toBe(true);
      expect(result.value.notes[0]).toMatch(/today/);
    }
  });

  it.each([
    ['missing name', { name: '   ' }, 'NAME_REQUIRED'],
    ['name too long', { name: 'x'.repeat(81) }, 'NAME_TOO_LONG'],
    ['bad id', { id: 'has space' }, 'INVALID_ID'],
    ['invalid date', { dateISO: '2027-02-30' }, 'INVALID_DATE'],
    ['past date', { dateISO: '2026-10-29' }, 'DATE_IN_PAST'],
    ['zero guests', { guestTarget: 0 }, 'INVALID_GUESTS'],
    ['negative guests', { guestTarget: -5 }, 'INVALID_GUESTS'],
    ['fractional guests', { guestTarget: 2.5 }, 'INVALID_GUESTS'],
    ['huge guests', { guestTarget: 10_000_000 }, 'INVALID_GUESTS'],
    ['zero budget', { budgetMinor: 0 }, 'INVALID_BUDGET'],
    ['negative budget', { budgetMinor: -1 }, 'INVALID_BUDGET'],
    ['fractional budget', { budgetMinor: 10.5 }, 'INVALID_BUDGET'],
    ['huge budget', { budgetMinor: 1e15 }, 'INVALID_BUDGET'],
    ['NaN budget', { budgetMinor: Number.NaN }, 'INVALID_BUDGET'],
    ['invalid currency', { currency: 'RUPEES' }, 'INVALID_CURRENCY'],
    ['lowercase currency', { currency: 'inr' }, 'INVALID_CURRENCY'],
  ])('rejects %s with a specific error', (_label, change, code) => {
    const result = createPlan({ ...BASE_INPUT, ...change }, TODAY);
    expect(result.ok ? 'OK' : result.error.code).toBe(code);
  });

  it('reports the offending field so the UI can link the error to the input', () => {
    const result = createPlan({ ...BASE_INPUT, budgetMinor: 0 }, TODAY);
    expect(!result.ok && result.error.field).toBe('budgetMinor');
  });
});
