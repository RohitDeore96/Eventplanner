import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, daysBetween } from '../../src/engine/dates';
import { generateMilestones, LARGE_EVENT_GUESTS } from '../../src/engine/milestones';
import type { Occasion } from '../../src/engine/types';
import { expectFailure, TODAY } from '../helpers';

const OCCASIONS: Occasion[] = ['wedding', 'birthday', 'community'];

function build(occasion: Occasion, daysAhead: number, guests = 50) {
  const dateISO = addDays(TODAY, daysAhead) ?? TODAY;
  return generateMilestones({ occasion, dateISO, guests, today: TODAY, idPrefix: 'e' });
}

describe('generateMilestones', () => {
  it('keeps the ideal schedule with plenty of notice and does not compress', () => {
    const result = build('wedding', 400);
    expect(result.ok && result.value.compressed).toBe(false);
    expect(result.ok && result.value.notes).toEqual([]);
  });

  it('compresses short notice, says so, and keeps the final task on the event date', () => {
    const result = build('wedding', 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.compressed).toBe(true);
    expect(result.value.notes[0]).toContain('10 day(s)');
    expect(result.value.tasks.at(-1)?.dueISO).toBe(addDays(TODAY, 10));
  });

  it('rejects past and malformed dates explicitly, naming the field', () => {
    const base = { occasion: 'wedding' as const, guests: 10, today: TODAY, idPrefix: 'e' };
    expectFailure(
      generateMilestones({ ...base, dateISO: '2026-10-01' }),
      'DATE_IN_PAST',
      'dateISO',
    );
    expectFailure(generateMilestones({ ...base, dateISO: 'soon' }), 'INVALID_DATE', 'dateISO');
    expectFailure(
      generateMilestones({ ...base, today: 'nope', dateISO: '2027-01-01' }),
      'INVALID_DATE',
      'dateISO',
    );
  });

  it('adds a crowd-planning task only for large events', () => {
    const small = build('community', 100, LARGE_EVENT_GUESTS - 1);
    const large = build('community', 100, LARGE_EVENT_GUESTS);
    const has = (r: typeof small) => r.ok && r.value.tasks.some((t) => t.id === 'e-crowd-plan');
    expect(has(small)).toBe(false);
    expect(has(large)).toBe(true);
  });

  it('property: never overdue, never after the event, dependencies never due later than dependants', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OCCASIONS),
        fc.integer({ min: 0, max: 500 }),
        fc.integer({ min: 1, max: 1000 }),
        (occasion, ahead, guests) => {
          const result = build(occasion, ahead, guests);
          if (!result.ok) return false;
          const eventDate = addDays(TODAY, ahead) ?? '';
          const byId = new Map(result.value.tasks.map((t) => [t.id, t]));
          return result.value.tasks.every(
            (t) =>
              (daysBetween(TODAY, t.dueISO) ?? -1) >= 0 &&
              (daysBetween(t.dueISO, eventDate) ?? -1) >= 0 &&
              t.dependsOn.every((d) => {
                const dep = byId.get(d);
                return dep !== undefined && dep.dueISO <= t.dueISO;
              }),
          );
        },
      ),
    );
  });

  it('property: task order is chronological (due dates never go backwards)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...OCCASIONS),
        fc.integer({ min: 0, max: 500 }),
        (occasion, ahead) => {
          const result = build(occasion, ahead);
          if (!result.ok) return false;
          const dates = result.value.tasks.map((t) => t.dueISO);
          return dates.every((d, i) => i === 0 || (dates[i - 1] ?? '') <= d);
        },
      ),
    );
  });
});

describe('generated schedule is pinned (golden)', () => {
  const outline = (occasion: Occasion, guests = 50): string[] => {
    const result = build(occasion, 365, guests);
    return result.ok
      ? result.value.tasks.map((t) => `${t.id}|${t.title}|${t.dueISO}|${t.dependsOn.join(',')}`)
      : [];
  };
  it.each(OCCASIONS)('%s with a year of notice', (occasion) => {
    expect(outline(occasion)).toMatchSnapshot();
  });
  it('places the crowd task chronologically for a large event', () => {
    expect(outline('wedding', LARGE_EVENT_GUESTS)).toMatchSnapshot();
  });
});
