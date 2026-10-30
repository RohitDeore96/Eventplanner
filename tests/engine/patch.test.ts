import { describe, expect, it } from 'vitest';
import type { PlanAction } from '../../src/engine/actions';
import { acceptPatch, applyAction, initHistory, redo, undo } from '../../src/engine/history';
import { applyPatch, dryRunPatch, type PatchAction, type PlanPatch } from '../../src/engine/patch';
import { comparePlans } from '../../src/engine/scenario';
import { summarize } from '../../src/engine/summary';
import { catId, deepFreeze, makePlan, run, TODAY } from '../helpers';

const plan = deepFreeze(makePlan());
const venue = catId(plan, 'venue');
const decor = catId(plan, 'decor');
const ctx = { today: TODAY };

const patch = (...actions: PatchAction[]): PlanPatch => ({ summary: 'Test patch', actions });
const addTask: PatchAction = {
  type: 'task/add',
  id: 'ai-1',
  title: 'Book a backup venue',
  dueISO: '2027-01-30',
  dependsOn: [],
  assignee: null,
};
const move: PatchAction = {
  type: 'budget/move',
  fromId: venue,
  toId: decor,
  amountMinor: 1_000_000,
};

describe('dryRunPatch', () => {
  it('reports exact before/after impact without touching the plan', () => {
    const result = dryRunPatch(plan, patch(addTask, move), TODAY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.blockedBy).toEqual([]);
    expect(result.value.comparison.tasksAdded).toEqual(['Book a backup venue']);
    const venueDelta = result.value.comparison.categories.find((c) => c.categoryId === venue);
    expect(venueDelta?.plannedAfter).toBe((venueDelta?.plannedBefore ?? 0) - 1_000_000);
    expect(result.value.comparison.plannedDelta).toBe(0);
    expect(plan.tasks.some((t) => t.id === 'ai-1')).toBe(false);
  });
  it('rejects empty, oversized and disallowed patches', () => {
    expect(dryRunPatch(plan, patch(), TODAY)).toMatchObject({
      ok: false,
      error: { code: 'PATCH_EMPTY' },
    });
    const many = Array.from({ length: 11 }, (_, i): PatchAction => ({ ...addTask, id: `ai-${i}` }));
    expect(dryRunPatch(plan, patch(...many), TODAY)).toMatchObject({
      ok: false,
      error: { code: 'PATCH_TOO_LARGE' },
    });
    const sneaky = { type: 'task/delete', id: plan.tasks[0]?.id ?? '' } as unknown as PatchAction;
    expect(dryRunPatch(plan, patch(sneaky), TODAY)).toMatchObject({
      ok: false,
      error: { code: 'PATCH_ACTION_NOT_ALLOWED' },
    });
    const expense = { type: 'expense/add' } as unknown as PatchAction;
    expect(dryRunPatch(plan, patch(expense), TODAY)).toMatchObject({
      ok: false,
      error: { code: 'PATCH_ACTION_NOT_ALLOWED' },
    });
  });
  it('fails the whole patch, atomically, when any step is invalid, and names the step', () => {
    const bad: PatchAction = { ...move, amountMinor: 999_999_999_999 };
    const result = dryRunPatch(plan, patch(addTask, bad), TODAY);
    expect(result).toMatchObject({ ok: false, error: { code: 'INSUFFICIENT_PLANNED' } });
    expect(!result.ok && result.error.message).toContain('Change 2');
  });
  it('flags a patch that breaks the budget and refuses to apply it', () => {
    const over: PatchAction = {
      type: 'category/add',
      id: 'ai-cat',
      name: 'Fireworks',
      plannedMinor: 5_000_000,
    };
    const dry = dryRunPatch(plan, patch(over), TODAY);
    expect(dry.ok && dry.value.blockedBy.map((w) => w.code)).toEqual(['OVER_ALLOCATED']);
    const applied = applyPatch(plan, patch(over), TODAY);
    expect(applied).toMatchObject({ ok: false, error: { code: 'PATCH_BREAKS_PLAN' } });
    expect(!applied.ok && applied.error.message).toContain('more than your budget');
  });
  it('applies a clean patch', () => {
    const applied = applyPatch(plan, patch(addTask, move), TODAY);
    expect(applied.ok && applied.value.tasks.some((t) => t.id === 'ai-1')).toBe(true);
  });
  it('treats an AI delay like a manual one, with ripple', () => {
    const first = plan.tasks[0]?.id ?? '';
    const dry = dryRunPatch(plan, patch({ type: 'task/delay', id: first, days: 400 }), TODAY);
    expect(dry.ok && dry.value.comparison.tasksRescheduled.length).toBeGreaterThan(1);
  });
});

describe('history: manual edits and accepted patches share one undo stack', () => {
  it('undoes and redoes a manual edit', () => {
    const h0 = initHistory(plan);
    const edit: PlanAction = { type: 'event/update', changes: { name: 'Renamed' } };
    const h1 = applyAction(h0, edit, ctx);
    expect(h1.ok && h1.value.present.name).toBe('Renamed');
    if (!h1.ok) return;
    const back = undo(h1.value);
    expect(back.present.name).toBe(plan.name);
    expect(redo(back).present.name).toBe('Renamed');
  });
  it('treats a whole accepted patch as a single undo step', () => {
    const h = acceptPatch(initHistory(plan), patch(addTask, move), ctx);
    expect(h.ok).toBe(true);
    if (!h.ok) return;
    expect(h.value.past).toHaveLength(1);
    expect(undo(h.value).present).toBe(plan);
  });
  it('does not push history for rejected actions or blocked patches', () => {
    const h0 = initHistory(plan);
    expect(applyAction(h0, { type: 'event/update', changes: { name: '' } }, ctx).ok).toBe(false);
    const over: PatchAction = {
      type: 'category/add',
      id: 'ai-cat',
      name: 'X',
      plannedMinor: 9_999_999_999,
    };
    expect(acceptPatch(h0, patch(over), ctx).ok).toBe(false);
  });
  it('undo and redo are no-ops at the ends; a new edit clears redo', () => {
    const h0 = initHistory(plan);
    expect(undo(h0)).toBe(h0);
    expect(redo(h0)).toBe(h0);
    const h1 = applyAction(h0, { type: 'event/update', changes: { name: 'A' } }, ctx);
    if (!h1.ok) throw new Error('setup');
    const h2 = applyAction(undo(h1.value), { type: 'event/update', changes: { name: 'B' } }, ctx);
    expect(h2.ok && h2.value.future).toEqual([]);
  });
  it('caps undo depth at 50', () => {
    let h = initHistory(plan);
    for (let i = 0; i < 60; i += 1) {
      const next = applyAction(h, { type: 'event/update', changes: { name: `N${i}` } }, ctx);
      if (!next.ok) throw new Error('setup');
      h = next.value;
    }
    expect(h.past).toHaveLength(50);
  });
});

describe('comparePlans (what-if scenarios)', () => {
  it('shows per-category deltas and new/resolved warnings', () => {
    const scenario = run(plan, {
      type: 'event/update',
      changes: { budgetMinor: 120_000_000, guestTarget: 200 },
    });
    const diff = comparePlans(plan, scenario, TODAY);
    expect(diff).toMatchObject({ budgetDelta: 20_000_000, guestTargetDelta: 80, plannedDelta: 0 });
    expect(diff.categories).toHaveLength(plan.categories.length);
    const lowered = run(plan, { type: 'event/update', changes: { budgetMinor: 50_000_000 } });
    expect(comparePlans(plan, lowered, TODAY).newWarnings.map((w) => w.code)).toContain(
      'OVER_ALLOCATED',
    );
    expect(comparePlans(lowered, plan, TODAY).resolvedWarnings.map((w) => w.code)).toContain(
      'OVER_ALLOCATED',
    );
  });
  it('reports added, removed and rescheduled tasks, and categories that exist on one side only', () => {
    const first = plan.tasks[0]?.id ?? '';
    const next = run(
      plan,
      { type: 'task/delete', id: plan.tasks.at(-1)?.id ?? '' },
      { type: 'task/update', id: first, dueISO: '2027-02-01' },
      { type: 'category/add', id: 'extra', name: 'Extra', plannedMinor: 0 },
    );
    const diff = comparePlans(plan, next, TODAY);
    expect(diff.tasksRemoved).toHaveLength(1);
    expect(diff.tasksRescheduled[0]).toMatchObject({ id: first, to: '2027-02-01' });
    expect(diff.categories.find((c) => c.categoryId === 'extra')).toMatchObject({
      plannedBefore: 0,
      plannedAfter: 0,
    });
    const reverse = comparePlans(next, plan, TODAY);
    expect(reverse.categories.find((c) => c.categoryId === 'extra')?.name).toBe('Extra');
    expect(reverse.tasksAdded).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('rolls everything the UI needs into one pure call', () => {
    const s = summarize(plan, TODAY);
    expect(s.readiness).toMatchObject({
      tasksDone: 0,
      tasksTotal: plan.tasks.length,
      overdue: 0,
      daysToEvent: 136,
      status: 'on_track',
    });
    expect(s.categories).toHaveLength(plan.categories.length);
    expect(s.catering).toMatchObject({ headcount: 120, basis: 'target' });
    expect(s.warnings).toEqual([]);
  });
  it('escalates status with warnings and errors', () => {
    const warn = run(
      plan,
      { type: 'guest/add', id: 'g', name: 'G', rsvp: 'yes', plusOnes: 10, dietary: [], group: '' },
      { type: 'event/update', changes: { guestTarget: 3 } },
    );
    expect(summarize(warn, TODAY).readiness.status).toBe('needs_attention');
    const bad = run(plan, { type: 'category/add', id: 'x', name: 'X', plannedMinor: 1 });
    expect(summarize(bad, TODAY).readiness.status).toBe('at_risk');
  });
  it('counts overdue items and survives a catering-less plan', () => {
    const noCat = run(plan, { type: 'category/delete', id: catId(plan, 'catering') });
    const s = summarize(noCat, '2027-12-01');
    expect(s.readiness.overdue).toBeGreaterThan(0);
    expect(s.catering.perHeadMinor).toBe(0);
  });
});
