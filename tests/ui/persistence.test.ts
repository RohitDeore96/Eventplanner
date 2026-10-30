import { describe, expect, it } from 'vitest';
import {
  clearSavedPlan,
  loadSavedPlan,
  savePlan,
  SCHEMA_VERSION,
} from '../../src/state/persistence';
import { makePlan, run } from '../helpers';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getLength: 0,
    clear: () => {
      map.clear();
    },
    getItem: (key: string) => map.get(key) ?? null,
    key: () => null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  } as unknown as Storage;
}

const plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 0,
  dietary: [],
  group: 'Family',
});

describe('persistence', () => {
  it('saves and loads a plan unchanged', () => {
    const storage = memoryStorage();
    expect(savePlan(plan, storage).ok).toBe(true);
    const loaded = loadSavedPlan(storage);
    expect(loaded).toEqual(plan);
  });

  it('migrates a version-0 record (no schemaVersion) forward', () => {
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ savedAtISO: '2026-10-30T00:00:00.000Z', plan }),
    });
    const loaded = loadSavedPlan(storage);
    expect(loaded).toEqual(plan);
  });

  it('refuses records written by a newer schema instead of guessing', () => {
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, plan }),
    });
    expect(loadSavedPlan(storage)).toBeNull();
  });

  it('returns null for corrupted JSON, wrong shapes and oversized payloads', () => {
    const corrupted = memoryStorage({ 'utsav.plans.v1': '{not json' });
    expect(loadSavedPlan(corrupted)).toBeNull();
    const wrong = memoryStorage({
      'utsav.plans.v1': JSON.stringify({ schemaVersion: 1, plan: { id: 5 } }),
    });
    expect(loadSavedPlan(wrong)).toBeNull();
    const huge = memoryStorage({ 'utsav.plans.v1': 'x'.repeat(400_001) });
    expect(loadSavedPlan(huge)).toBeNull();
  });

  it('reports when storage refuses writes and clears cleanly', () => {
    const failing: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        // nothing stored
      },
      clear: () => {
        // nothing stored
      },
      key: () => null,
      getLength: 0,
    } as unknown as Storage;
    const status = savePlan(plan, failing);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('refused');
    expect(() => {
      clearSavedPlan(failing);
    }).not.toThrow();
  });
});

/**
 * CRITICAL DEFECT 5 regression: persistence used to validate only the plan's top level and
 * accepted nested arrays of unknown records. Now every nested record is validated and the
 * domain invariants (referential integrity, dependency sanity) must hold.
 */
describe('persistence: deep validation of nested records', () => {
  function storedWith(planOverride: Record<string, unknown>): Storage {
    const base = plan as unknown as Record<string, unknown>;
    return memoryStorage({
      'utsav.plans.v1': JSON.stringify({
        schemaVersion: 1,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        plan: { ...base, ...planOverride },
      }),
    });
  }

  it('accepts a fully valid plan with vendors, expenses, tasks and guests', () => {
    expect(loadSavedPlan(storedWith({}))).toEqual(plan);
  });

  it.each([
    ['a vendor with an unknown booking status', { vendors: [{ ...badVendor, status: 'nope' }] }],
    ['a negative instalment amount', { vendors: [{ ...badVendor, schedule: badSchedule }] }],
    ['a non-integer expense amount', { expenses: badExpense }],
    ['a task depending on a missing id', { tasks: badTask }],
    ['an expense pointing at a missing vendor', { expenses: badExpenseRef }],
    ['a guest with an invalid dietary tag', { guests: badGuest }],
    ['an unknown extra key inside a nested record', { guests: badGuestExtraKey }],
  ])('rejects %s', (_label, override) => {
    expect(loadSavedPlan(storedWith(override))).toBeNull();
  });

  it('rejects a stored dependency cycle', () => {
    const tasks = [
      {
        id: 't1',
        title: 'A',
        dueISO: '2027-02-01',
        dependsOn: ['t2'],
        assignee: null,
        done: false,
      },
      {
        id: 't2',
        title: 'B',
        dueISO: '2027-02-02',
        dependsOn: ['t1'],
        assignee: null,
        done: false,
      },
    ];
    expect(loadSavedPlan(storedWith({ tasks }))).toBeNull();
  });
});

// Malformed records built from the valid guest list; each violates exactly one invariant.
const validGuest = plan.guests[0] as unknown as Record<string, unknown>;
const badVendor = {
  id: 'v9',
  categoryId: 'nope',
  name: 'X',
  contactNote: '',
  status: 'booked',
  committedMinor: null,
  schedule: [],
};
const badSchedule = [{ id: 'i1', kind: 'advance', dueISO: '2027-01-01', amountMinor: -5 }];
const badExpense = [{ ...plan.expenses[0], amountMinor: 12.5, vendorId: null, instalmentId: null }];
const badTask = [
  { id: 't9', title: 'T', dueISO: '2027-02-01', dependsOn: ['ghost'], assignee: null, done: false },
];
const badExpenseRef = [
  {
    id: 'x9',
    categoryId: plan.categories[0]?.id,
    vendorId: 'ghost',
    instalmentId: null,
    dateISO: '2026-11-01',
    amountMinor: 100,
    note: '',
  },
];
const badGuest = [{ ...validGuest, dietary: ['spicy'] }];
const badGuestExtraKey = [{ ...validGuest, sneaky: true }];
