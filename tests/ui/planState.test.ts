import { describe, expect, it } from 'vitest';
import { planReducer as reducePlan, type PlanState } from '../../src/state/planState';
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

describe('planState', () => {
  it('applies valid actions and clears errors', () => {
    const state: PlanState = { history: { past: [], present: plan, future: [] }, lastError: null };
    const next = reducePlan(
      state,
      { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } },
      TODAY,
    );
    expect(next.lastError).toBeNull();
    expect(next.history.present.guests).toHaveLength(0);
    expect(next.history.past).toHaveLength(1);
  });

  it('keeps the plan and records an error for rejected actions', () => {
    const state: PlanState = { history: { past: [], present: plan, future: [] }, lastError: null };
    const next = reducePlan(
      state,
      { kind: 'apply', action: { type: 'guest/update', id: 'ghost', name: 'X' } },
      TODAY,
    );
    expect(next.history.present).toBe(plan);
    expect(next.lastError?.code).toBe('GUEST_NOT_FOUND');
  });

  it('undo restores the previous plan, redo reapplies', () => {
    let state: PlanState = { history: { past: [], present: plan, future: [] }, lastError: null };
    state = reducePlan(state, { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } }, TODAY);
    expect(state.history.present.guests).toHaveLength(0);
    state = reducePlan(state, { kind: 'undo' }, TODAY);
    expect(state.history.present.guests).toHaveLength(1);
    state = reducePlan(state, { kind: 'redo' }, TODAY);
    expect(state.history.present.guests).toHaveLength(0);
  });

  it('replace starts a fresh history (used when a plan is created or imported)', () => {
    let state: PlanState = { history: { past: [], present: plan, future: [] }, lastError: null };
    state = reducePlan(state, { kind: 'apply', action: { type: 'guest/delete', id: 'g1' } }, TODAY);
    state = reducePlan(state, { kind: 'replace', plan }, TODAY);
    expect(state.history.past).toHaveLength(0);
    expect(state.history.present.guests).toHaveLength(1);
  });
});
