/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { buildSummaryText, exportCsv, exportSummary, exportTextFile } from '../../src/lib/export';
import { catId, makePlan, run, TODAY } from '../helpers';

/** The event summary export (Phase 3 §9.4): real engine numbers, aggregates, no PII. */
describe('event summary export (buildSummaryText)', () => {
  it('renders every section from engine output and never leaks guest details', () => {
    const base = makePlan({ budgetMinor: 100_000_000, guestTarget: 120 });
    const withVendor = run(
      base,
      {
        type: 'vendor/add',
        id: 'v-decor',
        categoryId: catId(base, 'decor'),
        name: 'Kumar Decor',
        contactNote: '',
        status: 'booked',
        committedMinor: 50_000_00,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v-decor',
        schedule: [
          { id: 'i-adv', kind: 'advance', dueISO: '2027-01-10', amountMinor: 20_000_00 },
          { id: 'i-fin', kind: 'final', dueISO: '2027-03-01', amountMinor: 30_000_00 },
        ],
      },
      {
        type: 'expense/add',
        id: 'exp-adv',
        categoryId: catId(base, 'decor'),
        vendorId: 'v-decor',
        instalmentId: 'i-adv',
        dateISO: '2026-11-05',
        amountMinor: 20_000_00,
        note: 'Advance',
      },
      {
        type: 'guest/add',
        id: 'g-1',
        name: 'Meera Iyer',
        rsvp: 'yes',
        plusOnes: 2,
        dietary: ['vegan'],
        group: 'friends',
        contact: '+91 98200 12345',
        note: 'Bring the mehendi favours',
      },
      {
        type: 'runsheet/add',
        id: 'rs-1',
        title: 'Baraat assembly',
        dateISO: '2027-03-15',
        startTime: '09:00',
        endTime: '09:30',
        ownerId: 'v-decor',
        location: 'Hotel gate',
        note: '',
      },
      {
        type: 'runsheet/add',
        id: 'rs-0',
        title: 'Haldi morning',
        dateISO: '2027-03-14',
        startTime: '10:00',
        endTime: '12:00',
        ownerId: null,
        location: '',
        note: '',
      },
    );

    const text = buildSummaryText(withVendor, TODAY);

    // Sections, in order, with the engine's own figures.
    expect(text).toContain('UTSAV — EVENT SUMMARY');
    expect(text).toContain('BUDGET OVERVIEW');
    expect(text).toContain('CATEGORIES');
    expect(text).toContain('VENDORS AND PAYMENTS');
    expect(text).toContain('GUESTS (aggregates only');
    expect(text).toContain('TASKS');
    expect(text).toContain('RUN SHEET');
    expect(text).toContain('WARNINGS');

    // Money: budget ₹10,00,000.00 in the plan's locale.
    expect(text).toContain('₹10,00,000.00');
    // The advance instalment is PAID (settled by an expense), the final is scheduled.
    expect(text).toContain('advance due 2027-01-10: ₹20,000.00 (PAID)');
    expect(text).toContain('final due 2027-03-01: ₹30,000.00 (scheduled)');
    // Run sheet entries appear in date order, with the vendor owner named.
    expect(text.indexOf('Haldi morning')).toBeGreaterThan(-1);
    expect(text.indexOf('Haldi morning')).toBeLessThan(text.indexOf('Baraat assembly'));
    expect(text).toContain('Kumar Decor');

    // Aggregates appear; individual guests and contact details never do.
    expect(text).toContain('Catering headcount: 3');
    expect(text).toContain('vegan 1');
    expect(text).not.toContain('Meera Iyer');
    expect(text).not.toContain('98200');
    expect(text).not.toContain('+91');
    expect(text).not.toContain('mehendi favours');
  });

  it('renders honest empty states and warnings', () => {
    const plan = run(makePlan(), {
      type: 'category/update',
      id: catId(makePlan(), 'venue'),
      plannedMinor: 90_000_000,
    });
    const text = buildSummaryText(plan, TODAY);
    expect(text).toContain('No vendors recorded yet.');
    expect(text).toContain('No event-day schedule yet.');
    // Over-allocation is visible, never silent.
    const warnings = text.slice(text.indexOf('WARNINGS'));
    expect(warnings).not.toContain('None. The plan is consistent.');
    expect(warnings).toMatch(/more than your budget/);
  });

  describe('event export downloads', () => {
    function stubDownload(): { urls: string[]; blobs: Blob[] } {
      const blobs: Blob[] = [];
      const urls: string[] = [];
      vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
        blobs.push(obj as Blob);
        const url = `blob:mock-${blobs.length}`;
        urls.push(url);
        return url;
      });
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
      return { urls, blobs };
    }

    it('CSV carries every expense row, including the no-note fallback', async () => {
      const stubs = stubDownload();
      const base = makePlan();
      const withExpenses = run(
        base,
        {
          type: 'expense/add',
          id: 'x1',
          categoryId: catId(base, 'decor'),
          vendorId: null,
          instalmentId: null,
          dateISO: '2026-11-01',
          amountMinor: 40_000_00,
          note: 'Flowers deposit',
        },
        {
          type: 'expense/add',
          id: 'x2',
          categoryId: catId(base, 'venue'),
          vendorId: null,
          instalmentId: null,
          dateISO: '2026-11-02',
          amountMinor: 150_000_00,
          note: '',
        },
      );

      exportCsv(withExpenses);
      expect(stubs.blobs).toHaveLength(1);
      const csv = await stubs.blobs[0]?.text();
      expect(csv).toContain('Expense');
      expect(csv).toContain('Flowers deposit');
      expect(csv).toContain('(no note)');
      expect(csv).toContain('4000000');
      expect(csv).toContain('INR');
    });

    it('summary and raw-text downloads produce files, not network calls', async () => {
      const stubs = stubDownload();
      const plan = makePlan();
      exportSummary(plan);
      exportTextFile('utsav-raw-plan.json', '{"kept":true}');
      expect(stubs.blobs).toHaveLength(2);
      const summary = await stubs.blobs[0]?.text();
      expect(summary).toContain('UTSAV — EVENT SUMMARY');
      const raw = await stubs.blobs[1]?.text();
      expect(raw).toBe('{"kept":true}');
      expect(stubs.blobs[0]?.type).toBe('text/plain;charset=utf-8');
      expect(stubs.blobs[1]?.type).toBe('application/json');
    });
  });
});
