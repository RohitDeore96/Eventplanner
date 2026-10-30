import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  formatISODate,
  isValidISODate,
  parseISODate,
} from '../../src/engine/dates';

describe('dates', () => {
  it('accepts real dates including leap days', () => {
    expect(isValidISODate('2028-02-29')).toBe(true);
    expect(parseISODate('1970-01-01')).toBe(0);
  });
  it.each([
    '2027-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '26-01-01',
    '2026-1-1',
    '',
    'tomorrow',
    '1969-12-31',
    '2201-01-01',
    '2026-01-01T00:00',
    'x2026-01-01',
    ' 2026-01-01',
    '12026-01-01',
    '2026-01-32',
    '2026-01-00',
    '2026-00-01',
  ])('rejects %s', (value) => {
    expect(parseISODate(value)).toBeNull();
  });
  it('accepts the first and last supported days', () => {
    expect(isValidISODate('1970-01-01')).toBe(true);
    expect(isValidISODate('2200-12-31')).toBe(true);
  });
  it('computes differences and offsets across month and year ends', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2027-01-01', '2026-12-31')).toBe(-1);
    expect(daysBetween('bad', '2027-01-01')).toBeNull();
    expect(daysBetween('2027-01-01', 'bad')).toBeNull();
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('refuses invalid input and out-of-range results', () => {
    expect(addDays('nope', 1)).toBeNull();
    expect(addDays('2026-01-01', 1.5)).toBeNull();
    expect(addDays('2200-12-31', 1)).toBeNull();
    expect(addDays('1970-01-01', -1)).toBeNull();
  });
  it('property: format and parse round-trip and addDays matches daysBetween', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 80_000 }),
        fc.integer({ min: -3000, max: 3000 }),
        (day, delta) => {
          const iso = formatISODate(day);
          if (parseISODate(iso) !== day) return false;
          const moved = addDays(iso, delta);
          return moved === null || daysBetween(iso, moved) === delta;
        },
      ),
    );
  });
});
