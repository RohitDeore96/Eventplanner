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

describe('milestone occasion (four occasion types)', () => {
  it('creates a milestone plan with its own categories, distinct from every other occasion', () => {
    const created = createPlan(
      { ...BASE_INPUT, occasion: 'milestone', name: 'Mom and Dad 25th' },
      TODAY,
    );
    if (!created.ok) throw new Error(created.error.message);
    const keys = created.value.plan.categories.map((c) => c.key);
    // Its own shape: photography and favours exist; wedding-only attire does not.
    expect(keys).toContain('favours');
    expect(keys).toContain('photography');
    expect(keys).not.toContain('attire');
    const others = (['wedding', 'birthday', 'community'] as const).map((occasion) => {
      const other = createPlan({ ...BASE_INPUT, occasion }, TODAY);
      if (!other.ok) throw new Error(other.error.message);
      return other.value.plan.categories.map((c) => `${c.key}:${c.plannedMinor}`).join('|');
    });
    const mine = created.value.plan.categories.map((c) => `${c.key}:${c.plannedMinor}`).join('|');
    expect(others).not.toContain(mine);
    // Category amounts still sum exactly to the budget.
    const total = created.value.plan.categories.reduce((sum, c) => sum + c.plannedMinor, 0);
    expect(total).toBe(BASE_INPUT.budgetMinor);
  });

  it('generates milestone-specific tasks including the memory-lane collection', () => {
    const created = createPlan({ ...BASE_INPUT, occasion: 'milestone' }, TODAY);
    if (!created.ok) throw new Error(created.error.message);
    const titles = created.value.plan.tasks.map((t) => t.title);
    expect(titles.some((t) => t.includes('memory lane'))).toBe(true);
    expect(titles.some((t) => t.includes('photographer'))).toBe(true);
  });
});
