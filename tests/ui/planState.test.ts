import { describe, expect, it } from 'vitest';
import {
  planReducer as reducePlan,
  initPlanState,
  type PlanState,
} from '../../src/state/planState';
import { makePlan, run, TODAY } from '../helpers';
import type { Plan } from '../../src/engine/types';

const plan: Plan = run(makePlan(), {
  type: 'guest/add',
  id: 'g1',
  name: 'Meera',
  rsvp: 'yes',
  plusOnes: 1,
  dietary: ['vegetarian'],
  group: 'Family',
});

const state = (plan: Plan): PlanState => initPlanState(plan);

describe('planState', () => {
  it('applies valid actions and clears errors', () => {
    const next = reducePlan(
      state(plan),
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    expect(next.lastError).toBeNull();
    expect(next.history.present.guests).toHaveLength(0);
    expect(next.history.past).toHaveLength(1);
  });

  it('keeps the plan and records an error for rejected actions', () => {
    const next = reducePlan(
      state(plan),
      { kind: 'apply', action: { type: 'guest/update', id: 'ghost', name: 'X' } },
      TODAY,
    );
    expect(next.history.present).toBe(plan);
    expect(next.lastError?.code).toBe('GUEST_NOT_FOUND');
  });

  it('undo restores the previous plan, redo reapplies', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    expect(current.history.present.guests).toHaveLength(0);
    current = reducePlan(current, { kind: 'undo' }, TODAY);
    expect(current.history.present.guests).toHaveLength(1);
    current = reducePlan(current, { kind: 'redo' }, TODAY);
    expect(current.history.present.guests).toHaveLength(0);
  });

  it('replace starts a fresh history (used when a plan is created or imported)', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    current = reducePlan(current, { kind: 'replace', plan }, TODAY);
    expect(current.history.past).toHaveLength(0);
    expect(current.history.present.guests).toHaveLength(1);
  });
});

describe('activity log (X9)', () => {
  it('records one human line per applied action, resolved against the plan before it', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    expect(current.log).toHaveLength(1);
    // 'g1' was deleted, yet the line still names Meera because the label was built first.
    expect(current.log[0]?.label).toBe('Guest “Meera” removed');
    expect(current.log[0]?.reverted).toBe(false);
    expect(current.log[0]?.atISO).toBeTruthy();
  });

  it('marks the newest entry undone on undo, live again on redo', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    current = reducePlan(current, { kind: 'undo' }, TODAY);
    expect(current.log[0]?.reverted).toBe(true);
    current = reducePlan(current, { kind: 'redo' }, TODAY);
    expect(current.log[0]?.reverted).toBe(false);
  });

  it('labels a batch with its given name and records AI patches with their summary', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      {
        kind: 'applyAll',
        actions: [{ type: 'guest/update', id: 'g1', rsvp: 'no' }],
        label: 'What-if scenario: Guests +20%',
      },
      TODAY,
    );
    expect(current.log[0]?.label).toBe('What-if scenario: Guests +20%');
    current = reducePlan(
      current,
      {
        kind: 'patch',
        patch: {
          summary: 'Add a haldi task',
          actions: [
            {
              type: 'task/add',
              id: 't-haldi',
              title: 'Haldi ceremony',
              dueISO: '2027-03-01',
              dependsOn: [],
              assignee: null,
            },
          ],
        },
      },
      TODAY,
    );
    expect(current.log[1]?.label).toBe('AI patch approved — “Add a haldi task”');
  });

  it('rejected actions add no log entry', () => {
    const current = reducePlan(
      state(plan),
      { kind: 'apply', action: { type: 'guest/update', id: 'ghost', name: 'X' } },
      TODAY,
    );
    expect(current.log).toHaveLength(0);
  });

  it('replace clears the log with the new plan', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    current = reducePlan(current, { kind: 'replace', plan }, TODAY);
    expect(current.log).toHaveLength(0);
  });

  it('describes money actions with the plan currency and names', () => {
    let current = state(plan);
    current = reducePlan(
      current,
      {
        kind: 'apply',
        action: {
          type: 'expense/add',
          id: 'e1',
          categoryId: plan.categories.find((c) => c.key === 'venue')?.id ?? '',
          vendorId: null,
          instalmentId: null,
          dateISO: TODAY,
          amountMinor: 2_000_000,
          note: 'venue advance',
        },
      },
      TODAY,
    );
    expect(current.log[0]?.label).toContain('venue advance');
    expect(current.log[0]?.label).toMatch(/20,000/);
  });
});
