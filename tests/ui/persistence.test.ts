import { describe, expect, it } from 'vitest';
import {
  clearSavedPlan,
  loadSavedPlan,
  loadSavedState,
  loadWorkspace,
  savePlan,
  saveWorkspace,
  SCHEMA_VERSION,
} from '../../src/state/persistence';
import type { Plan } from '../../src/engine/types';
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

/**
 * Milestone 6 hardening regressions: duplicate ids, unsupported currencies, non-calendar
 * dates and cross-vendor instalment references must all be rejected; the legacy
 * `utsav.activeId.v1` key must be scrubbed; and unusable stored data must come back with
 * a recovery reason plus the raw text for an exportable copy.
 */
describe('persistence: storage invariants', () => {
  function storedPlan(base: Plan, override: Record<string, unknown>): Storage {
    return memoryStorage({
      'utsav.plans.v1': JSON.stringify({
        schemaVersion: 1,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        plan: { ...(base as unknown as Record<string, unknown>), ...override },
      }),
    });
  }

  const vendorPlan = run(plan, {
    type: 'vendor/add',
    id: 'v1',
    categoryId: plan.categories[0]?.id ?? '',
    name: 'Sharma Caterers',
    contactNote: '',
    status: 'booked',
    committedMinor: 500_000,
  });
  const vendorId = vendorPlan.vendors[0]?.id ?? '';
  const scheduledPlan = run(vendorPlan, {
    type: 'vendor/setSchedule',
    id: vendorId,
    schedule: [{ id: 'i1', kind: 'advance', dueISO: '2027-01-01', amountMinor: 250_000 }],
  });
  const paidPlan = run(scheduledPlan, {
    type: 'expense/add',
    id: 'x1',
    categoryId: plan.categories[0]?.id ?? '',
    vendorId,
    instalmentId: 'i1',
    dateISO: '2026-11-01',
    amountMinor: 100_000,
    note: 'advance',
  });

  it('rejects duplicate category, vendor, expense, task or guest ids', () => {
    const vendor = JSON.parse(JSON.stringify(vendorPlan.vendors[0])) as Record<string, unknown>;
    expect(loadSavedPlan(storedPlan(vendorPlan, { vendors: [vendor, vendor] }))).toBeNull();
    expect(
      loadSavedPlan(storedPlan(plan, { categories: [...plan.categories, plan.categories[0]] })),
    ).toBeNull();
  });

  it('rejects duplicate instalment ids across vendors', () => {
    const bookedVendor = JSON.parse(JSON.stringify(scheduledPlan.vendors[0])) as Record<
      string,
      unknown
    >;
    const secondVendor = {
      ...bookedVendor,
      id: 'v2',
      schedule: [{ id: 'i1', kind: 'final', dueISO: '2027-02-01', amountMinor: 100_000 }],
    };
    expect(
      loadSavedPlan(storedPlan(scheduledPlan, { vendors: [bookedVendor, secondVendor] })),
    ).toBeNull();
  });

  it('rejects an unsupported or malformed currency code', () => {
    expect(loadSavedPlan(storedPlan(plan, { currency: 'XYZ' }))).toBeNull();
    expect(loadSavedPlan(storedPlan(plan, { currency: 'XX' }))).toBeNull();
  });

  it('rejects dates that are not real calendar days (2027-02-30)', () => {
    expect(loadSavedPlan(storedPlan(plan, { dateISO: '2027-02-30' }))).toBeNull();
    expect(loadSavedPlan(storedPlan(paidPlan, { dateISO: '2027-04-31' }))).toBeNull();
  });

  it('rejects an instalment reference that belongs to a different vendor', () => {
    const secondVendor = {
      ...(JSON.parse(JSON.stringify(vendorPlan.vendors[0])) as Record<string, unknown>),
      id: 'v2',
      schedule: [{ id: 'i2', kind: 'final', dueISO: '2027-02-01', amountMinor: 100_000 }],
    };
    const crossVendor = JSON.parse(JSON.stringify(paidPlan)) as Record<string, unknown>;
    const vendors = [vendorPlan.vendors[0], secondVendor];
    const expenses = (crossVendor.expenses as Record<string, unknown>[]).map((e) => ({
      ...e,
      instalmentId: 'i2', // paid against v1's expense, but i2 belongs to v2
    }));
    expect(loadSavedPlan(storedPlan(paidPlan, { vendors, expenses }))).toBeNull();
    // An instalment reference with no vendor at all is equally invalid.
    const orphan = (crossVendor.expenses as Record<string, unknown>[]).map((e) => ({
      ...e,
      vendorId: null,
    }));
    expect(loadSavedPlan(storedPlan(paidPlan, { expenses: orphan }))).toBeNull();
  });

  it('accepts the fully valid vendor + schedule + payment plan', () => {
    expect(loadSavedPlan(storedPlan(paidPlan, {}))).toEqual(paidPlan);
  });

  it('never writes the legacy active-plan key and scrubs it from old installs', () => {
    const storage = memoryStorage({ 'utsav.activeId.v1': 'ev-sentinel' });
    expect(savePlan(plan, storage).ok).toBe(true);
    expect(storage.getItem('utsav.activeId.v1')).toBeNull();
    const other = memoryStorage({ 'utsav.activeId.v1': 'stale' });
    clearSavedPlan(other);
    expect(other.getItem('utsav.activeId.v1')).toBeNull();
  });
});

describe('persistence: recovery information for unusable stored data', () => {
  it('reports unreadable JSON with the untouched raw text', () => {
    const state = loadSavedState(memoryStorage({ 'utsav.plans.v1': '{not json' }));
    expect(state.plan).toBeNull();
    expect(state.recovery).toMatchObject({ reason: 'unreadable', raw: '{not json' });
  });

  it('drops an invalid event alone and reports the count, not a dead record', () => {
    const state = loadSavedState(
      memoryStorage({
        'utsav.plans.v1': JSON.stringify({ schemaVersion: 1, plan: { id: 5 } }),
      }),
    );
    expect(state.plan).toBeNull();
    expect(state.recovery).toBeNull();
    const workspace = loadWorkspace(
      memoryStorage({
        'utsav.plans.v1': JSON.stringify({ schemaVersion: 1, plan: { id: 5 } }),
      }),
    );
    expect(workspace.plans).toHaveLength(0);
    expect(workspace.droppedInvalid).toBe(1);
  });

  it('reports records from a newer schema as newer_version', () => {
    const state = loadSavedState(
      memoryStorage({
        'utsav.plans.v1': JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, plan }),
      }),
    );
    expect(state.recovery?.reason).toBe('newer_version');
  });

  it('reports oversized records as too_large', () => {
    const state = loadSavedState(memoryStorage({ 'utsav.plans.v1': 'x'.repeat(400_001) }));
    expect(state.recovery?.reason).toBe('too_large');
  });

  it('valid plans load with no recovery notice', () => {
    const state = loadSavedState(memoryStorage());
    expect(state).toEqual({ plan: null, recovery: null });
    expect(loadSavedState(memoryStorage()).recovery).toBeNull();
    expect(
      loadSavedPlan(
        memoryStorage({ 'utsav.plans.v1': JSON.stringify({ schemaVersion: 1, plan }) }),
      ),
    ).toEqual(plan);
  });
});

describe('multi-event workspace (R8)', () => {
  const other = makePlan({ id: 'ev2', name: 'Diwali party', budgetMinor: 50_000_000 });

  it('round-trips several events with the active marker', () => {
    const storage = memoryStorage();
    expect(saveWorkspace([plan, other], other.id, storage).ok).toBe(true);
    const workspace = loadWorkspace(storage);
    expect(workspace.plans.map((p) => p.name)).toEqual([plan.name, other.name]);
    expect(workspace.activeId).toBe(other.id);
    expect(workspace.droppedInvalid).toBe(0);
    expect(loadSavedPlan(storage)).toEqual(other);
  });

  it('migrates a version-1 single-plan record into a one-event workspace', () => {
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({
        schemaVersion: 1,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        plan,
      }),
    });
    const workspace = loadWorkspace(storage);
    expect(workspace.plans).toHaveLength(1);
    expect(workspace.activeId).toBe(plan.id);
    expect(workspace.droppedInvalid).toBe(0);
    // Saving forward writes the v2 shape.
    expect(saveWorkspace(workspace.plans, workspace.activeId, storage).ok).toBe(true);
    const raw = JSON.parse(storage.getItem('utsav.plans.v1') ?? '{}') as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(2);
  });

  it('keeps the surviving events when one saved event is invalid', () => {
    const broken = { ...plan, currency: 'XXX' };
    const storage = memoryStorage({
      'utsav.plans.v1': JSON.stringify({
        schemaVersion: 2,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: plan.id,
        plans: [broken, other],
      }),
    });
    const workspace = loadWorkspace(storage);
    expect(workspace.plans).toHaveLength(1);
    expect(workspace.plans[0]?.name).toBe(other.name);
    // The invalid event was active, so the first survivor becomes active.
    expect(workspace.activeId).toBe(other.id);
    expect(workspace.droppedInvalid).toBe(1);
  });

  it('savePlan upserts: editing keeps other events, a new id joins as active', () => {
    const storage = memoryStorage();
    saveWorkspace([plan, other], plan.id, storage);
    // Edit the active event in place.
    const edited = { ...plan, name: 'Asha & Dev wedding (updated)' };
    savePlan(edited, storage);
    let workspace = loadWorkspace(storage);
    expect(workspace.plans).toHaveLength(2);
    expect(workspace.activeId).toBe(plan.id);
    expect(workspace.plans.find((p) => p.id === plan.id)?.name).toContain('updated');
    // A brand-new event joins and becomes active.
    const third = makePlan({ id: 'ev3', name: 'Housewarming' });
    savePlan(third, storage);
    workspace = loadWorkspace(storage);
    expect(workspace.plans).toHaveLength(3);
    expect(workspace.activeId).toBe('ev3');
    expect(loadSavedPlan(storage)?.name).toBe('Housewarming');
  });

  it('refuses to store more events than the cap allows', () => {
    const storage = memoryStorage();
    const many = Array.from({ length: 13 }, (_, i) =>
      makePlan({ id: `ev-cap-${i}`, name: `Event ${i}` }),
    );
    const status = saveWorkspace(many, many[0]?.id ?? null, storage);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('12 events');
    // 12 fit exactly.
    expect(saveWorkspace(many.slice(0, 12), 'ev-cap-0', storage).ok).toBe(true);
  });

  it('clearSavedPlan removes the whole workspace', () => {
    const storage = memoryStorage();
    saveWorkspace([plan, other], plan.id, storage);
    clearSavedPlan(storage);
    expect(loadWorkspace(storage).plans).toHaveLength(0);
  });
});
