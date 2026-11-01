/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { loadWorkspace } from '../../src/state/persistence';
import { makePlan } from '../helpers';

/**
 * Deep-validation branch coverage (M6 hardening carried into Phase 2): every corrupted
 * relationship is dropped on its own — the rest of the workspace survives untouched.
 */

function seed(raw: unknown): ReturnType<typeof loadWorkspace> {
  localStorage.setItem('utsav.plans.v1', JSON.stringify(raw));
  return loadWorkspace();
}

const base = (): ReturnType<typeof makePlan> => makePlan({ id: 'ev-good' });

describe('deep validation of Phase 2 relationships', () => {
  it('drops a plan whose run-sheet activity points at a missing vendor', () => {
    const plan = base();
    const corrupted = {
      ...plan,
      id: 'ev-bad',
      runSheet: [
        {
          id: 'r1',
          title: 'Ghost owner',
          dateISO: '2027-03-15',
          startTime: '09:00',
          endTime: '10:00',
          ownerId: 'v-ghost',
          location: '',
          note: '',
          done: false,
        },
      ],
    };
    const ws = seed({
      schemaVersion: 3,
      activeId: 'ev-good',
      archivedIds: [],
      plans: [plan, corrupted],
    });
    expect(ws.plans.map((p) => p.id)).toEqual(['ev-good']);
    expect(ws.droppedInvalid).toBe(1);
  });

  it('drops a plan whose run sheet has a backwards time range', () => {
    const plan = base();
    const corrupted = {
      ...plan,
      id: 'ev-bad',
      runSheet: [
        {
          id: 'r1',
          title: 'Impossible slot',
          dateISO: '2027-03-15',
          startTime: '12:00',
          endTime: '09:00',
          ownerId: null,
          location: '',
          note: '',
          done: false,
        },
      ],
    };
    const ws = seed({
      schemaVersion: 3,
      activeId: 'ev-good',
      archivedIds: [],
      plans: [plan, corrupted],
    });
    expect(ws.plans.map((p) => p.id)).toEqual(['ev-good']);
  });

  it('drops a plan with a vendor pointing at a missing category', () => {
    const plan = base();
    const corrupted = {
      ...plan,
      id: 'ev-bad',
      vendors: [
        {
          id: 'v1',
          categoryId: 'cat-ghost',
          name: 'Ghost vendor',
          contactNote: '',
          contactPerson: '',
          phone: '',
          email: '',
          status: 'booked',
          committedMinor: 1_000_000,
          schedule: [],
        },
      ],
    };
    const ws = seed({
      schemaVersion: 3,
      activeId: 'ev-good',
      archivedIds: [],
      plans: [plan, corrupted],
    });
    expect(ws.plans.map((p) => p.id)).toEqual(['ev-good']);
  });

  it('drops a plan with an expense whose instalment belongs to another vendor', () => {
    const plan = base();
    const corrupted = {
      ...plan,
      id: 'ev-bad',
      vendors: [
        {
          id: 'vA',
          categoryId: plan.categories[0]?.id ?? 'c',
          name: 'Vendor A',
          contactNote: '',
          contactPerson: '',
          phone: '',
          email: '',
          status: 'booked',
          committedMinor: 1_000_000,
          schedule: [
            { id: 'iA', kind: 'advance', dueISO: '2027-01-01', amountMinor: 100, note: '' },
          ],
        },
        {
          id: 'vB',
          categoryId: plan.categories[0]?.id ?? 'c',
          name: 'Vendor B',
          contactNote: '',
          contactPerson: '',
          phone: '',
          email: '',
          status: 'booked',
          committedMinor: 1_000_000,
          schedule: [
            { id: 'iB', kind: 'advance', dueISO: '2027-01-02', amountMinor: 100, note: '' },
          ],
        },
      ],
      expenses: [
        {
          id: 'x1',
          categoryId: plan.categories[0]?.id ?? 'c',
          vendorId: 'vB',
          instalmentId: 'iA',
          dateISO: '2027-01-03',
          amountMinor: 50,
          note: 'cross-vendor link',
        },
      ],
    };
    const ws = seed({
      schemaVersion: 3,
      activeId: 'ev-good',
      archivedIds: [],
      plans: [plan, corrupted],
    });
    expect(ws.plans.map((p) => p.id)).toEqual(['ev-good']);
  });

  it('drops archived ids that do not match any stored plan', () => {
    const plan = base();
    const ws = seed({
      schemaVersion: 3,
      activeId: 'ev-good',
      archivedIds: ['ghost-1', 'ghost-2'],
      plans: [plan],
    });
    expect(ws.archivedIds).toEqual([]);
  });

  it('keeps the archive list when a v2 record gains one by save-forward', () => {
    const plan = base();
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({ schemaVersion: 2, savedAtISO: 'x', activeId: 'ev-good', plans: [plan] }),
    );
    const ws = loadWorkspace();
    expect(ws.archivedIds).toEqual([]);
    expect(ws.plans).toHaveLength(1);
  });
});
