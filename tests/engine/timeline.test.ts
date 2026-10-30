import { describe, expect, it } from 'vitest';
import { buildIcs, escapeIcsText, foldIcsLine } from '../../src/engine/ics';
import { buildTimeline } from '../../src/engine/timeline';
import { catId, makePlan, run, TODAY } from '../helpers';

const plan = makePlan();
const venue = catId(plan, 'venue');
const withPayment = run(
  plan,
  {
    type: 'vendor/add',
    id: 'v1',
    categoryId: venue,
    name: 'Grand Hall',
    contactNote: '',
    status: 'booked',
    committedMinor: 1_000_000,
  },
  {
    type: 'vendor/setSchedule',
    id: 'v1',
    schedule: [
      { id: 'i1', kind: 'advance', dueISO: '2026-10-20', amountMinor: 400_000 },
      { id: 'i2', kind: 'balance', dueISO: '2027-03-01', amountMinor: 600_000 },
    ],
  },
);

describe('buildTimeline', () => {
  it('merges tasks and unpaid vendor payments in date order', () => {
    const items = buildTimeline(withPayment, TODAY);
    expect(items.filter((i) => i.kind === 'payment')).toHaveLength(2);
    expect(items.map((i) => i.dueISO)).toEqual([...items.map((i) => i.dueISO)].sort());
    expect(items[0]).toMatchObject({
      kind: 'payment',
      id: 'i1',
      overdue: true,
      amountMinor: 400_000,
    });
  });
  it('marks a payment done once an expense settles it', () => {
    const paid = run(withPayment, {
      type: 'expense/add',
      id: 'x',
      categoryId: venue,
      vendorId: 'v1',
      instalmentId: 'i1',
      dateISO: TODAY,
      amountMinor: 400_000,
      note: '',
    });
    expect(buildTimeline(paid, TODAY)[0]).toMatchObject({ id: 'i1', done: true, overdue: false });
  });
  it('flags overdue tasks but not done ones, and handles an empty plan', () => {
    const late = buildTimeline(plan, '2027-12-01');
    expect(late.every((i) => i.overdue)).toBe(true);
    expect(buildTimeline({ ...plan, tasks: [] }, TODAY)).toEqual([]);
  });
});

describe('ics', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
  });
  it('folds long lines at 75 octets without splitting multibyte characters', () => {
    const line = `SUMMARY:${'नमस्ते '.repeat(30)}`;
    const folded = foldIcsLine(line);
    const physical = folded.split('\r\n');
    expect(physical.length).toBeGreaterThan(1);
    for (const [i, part] of physical.entries()) {
      expect(new TextEncoder().encode(i === 0 ? part : part).length).toBeLessThanOrEqual(75);
      if (i > 0) expect(part.startsWith(' ')).toBe(true);
    }
    expect(physical.map((p, i) => (i === 0 ? p : p.slice(1))).join('')).toBe(line);
  });
  it('leaves short lines alone', () => {
    expect(foldIcsLine('BEGIN:VCALENDAR')).toBe('BEGIN:VCALENDAR');
  });
  it('builds a valid calendar with CRLF endings and one event per item', () => {
    const items = buildTimeline(withPayment, TODAY);
    const ics = buildIcs('Asha; Dev, wedding', items, TODAY);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(items.length);
    expect(ics).toContain('X-WR-CALNAME:Asha\\; Dev\\, wedding');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261020');
    expect(ics).toContain('SUMMARY:Pay Grand Hall (advance)');
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
  });
});
