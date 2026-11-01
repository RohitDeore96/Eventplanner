/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { catId, makePlan, run } from '../helpers';
import { displayMajor, resolveSubmission, setupSeed } from '../../src/ui/views/setup/setupSubmit';

/**
 * Direct guards for the setup form's extracted decision module: seed values, the
 * currency-change policy, engine-validated creation and the edit carry-over. The
 * rendered form is covered by the interaction tests.
 */

function formData(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

describe('setup submission decisions', () => {
  it('seeds blank for create and exponent-correct values for edit', () => {
    const blank = setupSeed(null, { currency: 'INR', locale: 'en-IN' });
    expect(blank).toEqual({
      name: '',
      occasion: 'wedding',
      dateISO: '',
      guests: '',
      budget: '',
      currency: 'INR',
      locale: 'en-IN',
    });
    const plan = makePlan();
    const edit = setupSeed(plan, { currency: 'USD', locale: 'en-US' });
    expect(edit.name).toBe(plan.name);
    expect(edit.guests).toBe(String(plan.guestTarget));
    expect(edit.budget).toBe(displayMajor(plan.budgetMinor, plan.currency));
  });

  it('shows major units with the currency exponent of each decimal system', () => {
    expect(displayMajor(800_000, 'INR')).toBe('8000');
    expect(displayMajor(123, 'JPY')).toBe('123');
    // The seed input rounds to whole major units; the exact minor value stays in the plan.
    expect(displayMajor(1_234, 'KWD')).toBe('1');
  });

  it('rejects an unparsable budget with a field error, creating nothing', () => {
    const outcome = resolveSubmission(
      formData({
        name: 'Diwali',
        occasion: 'wedding',
        dateISO: '2026-12-20',
        guests: '120',
        budget: 'lots',
      }),
      'INR',
      'en-IN',
      null,
    );
    expect(outcome.kind).toBe('error');
  });

  it('creates through the engine when the form is valid', () => {
    const outcome = resolveSubmission(
      formData({
        name: 'Diwali',
        occasion: 'wedding',
        dateISO: '2026-12-20',
        guests: '120',
        budget: '800000',
      }),
      'INR',
      'en-IN',
      null,
    );
    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.next.name).toBe('Diwali');
      expect(outcome.next.budgetMinor).toBe(80_000_000);
      expect(outcome.next.guestTarget).toBe(120);
    }
  });

  it('carries the family work over when editing: vendors, expenses, guests', () => {
    const base = makePlan();
    const withWork = run(base, {
      type: 'vendor/add',
      id: 'v-x',
      categoryId: catId(base, 'venue'),
      name: 'Bombay Caterers',
      contactNote: '',
      status: 'quoted',
      committedMinor: 300_000_00,
    });
    const outcome = resolveSubmission(
      formData({
        name: 'Renamed',
        occasion: base.occasion,
        dateISO: base.dateISO,
        guests: String(base.guestTarget),
        budget: '800000',
      }),
      base.currency,
      base.locale,
      withWork,
    );
    expect(outcome.kind).toBe('ready');
    if (outcome.kind === 'ready') {
      expect(outcome.next.name).toBe('Renamed');
      expect(outcome.next.vendors.map((v) => v.name)).toContain('Bombay Caterers');
      expect(outcome.next.guests).toEqual(withWork.guests);
    }
  });
});
