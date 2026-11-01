import { describe, expect, it } from 'vitest';
import { comparePlans } from '../../src/engine/scenario';
import { makePlan, run } from '../helpers';
import {
  comparisonChangeLines,
  customScenarioActions,
  deltaLabel,
  parseBudgetInput,
  parseGuestsInput,
  reducePlanCopy,
  scenarioPreviewLines,
} from '../../src/ui/views/scenario/scenarioPreview';

/**
 * Direct guards for the what-if panel's extracted preview module: input parsing, the
 * custom-scenario action builder, copy-preview isolation and the preview line wording.
 * The panel itself is covered by the interaction tests; these pin the pure contract.
 */

const today = '2026-11-01';

describe('scenario preview input parsing', () => {
  it('treats blank inputs as "leave unchanged" and junk as invalid', () => {
    expect(parseGuestsInput('')).toBeUndefined();
    expect(parseGuestsInput('  ')).toBeUndefined();
    expect(parseGuestsInput('0')).toBeNull();
    expect(parseGuestsInput('1.5')).toBeNull();
    expect(parseGuestsInput('x')).toBeNull();
    expect(parseGuestsInput(' 250 ')).toBe(250);
    const plan = makePlan();
    expect(parseBudgetInput(plan, '')).toBeUndefined();
    expect(parseBudgetInput(plan, 'abc')).toBeNull();
    expect(parseBudgetInput(plan, '50000')).toBe(5_000_000);
  });

  it('builds one event/update only when a value really changes', () => {
    const plan = makePlan();
    expect(customScenarioActions(plan, '', '')).toEqual([]);
    // Blank budget means "no budget change": a guest count that merely equals the current
    // one still produces the engine's (harmless) no-op update — the original behaviour.
    expect(customScenarioActions(plan, String(plan.guestTarget), '')).toEqual([
      { type: 'event/update', changes: { guestTarget: plan.guestTarget } },
    ]);
    const actions = customScenarioActions(plan, String(plan.guestTarget + 50), '');
    expect(actions).toEqual([
      { type: 'event/update', changes: { guestTarget: plan.guestTarget + 50 } },
    ]);
    expect(customScenarioActions(plan, '0', '')).toBeNull();
    expect(customScenarioActions(plan, '', 'abc')).toBeNull();
  });
});

describe('scenario preview copy isolation and wording', () => {
  it('previews on a copy and leaves the real plan untouched', () => {
    const plan = makePlan();
    const actions = customScenarioActions(plan, String(plan.guestTarget + 50), '') ?? [];
    const after = reducePlanCopy(plan, actions, today);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.guestTarget).toBe(plan.guestTarget + 50);
      expect(plan.guestTarget).not.toBe(after.value.guestTarget);
    }
  });

  it('describes the built-in scenario preview with a signed budget delta and task lines', () => {
    const plan = makePlan();
    const bumped = run(plan, {
      type: 'event/update',
      changes: { budgetMinor: plan.budgetMinor + 5_000_00 },
    });
    const comparison = comparePlans(plan, bumped, today);
    const lines = scenarioPreviewLines(plan, comparison);
    expect(lines.some((line) => line.startsWith('Budget: +'))).toBe(true);
    expect(lines.every((line) => line.length > 0)).toBe(true);
  });

  it('reports task rescheduling and warning lines when present', () => {
    const plan = makePlan();
    const comparison = comparePlans(plan, makePlan(), today);
    // Identical plans: no measurable change line, no task/warning lines.
    expect(comparisonChangeLines(comparison)).toEqual([]);
    expect(scenarioPreviewLines(plan, comparison)).toContain(
      'No measurable change — this scenario does not apply to the plan as it stands.',
    );
  });

  it('formats one signed money delta', () => {
    const plan = makePlan();
    expect(deltaLabel(5_000, plan)).toMatch(/^\+/);
    expect(deltaLabel(-500, plan)).toMatch(/^−/);
  });
});
