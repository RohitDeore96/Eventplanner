import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  delayTask,
  removeTask,
  reorderTask,
  setDependencies,
  wouldCreateCycle,
} from '../../src/engine/tasks';
import type { Task } from '../../src/engine/types';
import { expectFailure } from '../helpers';

const task = (id: string, dueISO: string, dependsOn: string[] = [], done = false): Task => ({
  id,
  title: `Task ${id}`,
  dueISO,
  dependsOn,
  assignee: null,
  done,
});

const chain = [
  task('a', '2027-01-10'),
  task('b', '2027-01-12', ['a']),
  task('c', '2027-01-15', ['b']),
  task('x', '2027-01-11'),
];

describe('cycle prevention', () => {
  it('detects self, direct and transitive cycles', () => {
    expect(wouldCreateCycle(chain, 'a', ['a'])).toBe(true);
    expect(wouldCreateCycle(chain, 'a', ['b'])).toBe(true);
    expect(wouldCreateCycle(chain, 'a', ['c'])).toBe(true);
    expect(wouldCreateCycle(chain, 'c', ['a'])).toBe(false);
    expect(wouldCreateCycle(chain, 'x', ['a', 'b'])).toBe(false);
  });
  it('setDependencies rejects cycles with a plain message and leaves tasks untouched', () => {
    const result = setDependencies(chain, 'a', ['c']);
    expect(!result.ok && result.error.code).toBe('DEPENDENCY_CYCLE');
    expect(!result.ok && result.error.message).toMatch(/loop/);
  });
  it('setDependencies validates ids, size and duplicates', () => {
    expect(setDependencies(chain, 'zzz', [])).toMatchObject({
      ok: false,
      error: { code: 'TASK_NOT_FOUND' },
    });
    expect(setDependencies(chain, 'x', ['nope'])).toMatchObject({
      ok: false,
      error: { code: 'DEPENDENCY_NOT_FOUND' },
    });
    const many = Array.from({ length: 11 }, (_, i) => task(`t${i}`, '2027-01-01'));
    expect(
      setDependencies(
        [...many, task('z', '2027-01-02')],
        'z',
        many.map((t) => t.id),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'TOO_MANY_DEPENDENCIES' },
    });
    const dedup = setDependencies(chain, 'x', ['a', 'a']);
    expect(dedup.ok && dedup.value.find((t) => t.id === 'x')?.dependsOn).toEqual(['a']);
  });
  it('property: accepted dependency edits never produce a cycle', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.integer({ min: 0, max: 5 }),
            fc.array(fc.integer({ min: 0, max: 5 }), { maxLength: 3 }),
          ),
          { maxLength: 25 },
        ),
        (edits) => {
          let tasks = Array.from({ length: 6 }, (_, i) => task(`t${i}`, '2027-01-01'));
          for (const [target, deps] of edits) {
            const result = setDependencies(
              tasks,
              `t${target}`,
              deps.map((d) => `t${d}`),
            );
            if (result.ok) tasks = result.value;
          }
          return tasks.every(
            (t) =>
              !wouldCreateCycle(
                tasks.map((o) => (o.id === t.id ? { ...o, dependsOn: [] } : o)),
                t.id,
                t.dependsOn,
              ),
          );
        },
      ),
    );
  });
});

describe('removeTask', () => {
  it('detaches dependants and reports who was affected', () => {
    const result = removeTask(chain, 'b');
    expect(result.ok && result.value.detachedFrom).toEqual(['c']);
    expect(result.ok && result.value.tasks.find((t) => t.id === 'c')?.dependsOn).toEqual([]);
    expect(result.ok && result.value.tasks).toHaveLength(3);
  });
  it('fails for unknown ids, and handles an empty list', () => {
    expect(removeTask(chain, 'nope')).toMatchObject({ ok: false });
    expect(removeTask([], 'a')).toMatchObject({ ok: false });
  });
});

describe('reorderTask', () => {
  it('moves a task and clamps out-of-range targets', () => {
    expect(reorderTask(chain, 'a', 2)).toMatchObject({ ok: true });
    const toEnd = reorderTask(chain, 'a', 99);
    expect(toEnd.ok && toEnd.value.map((t) => t.id)).toEqual(['b', 'c', 'x', 'a']);
    const toStart = reorderTask(chain, 'x', -5);
    expect(toStart.ok && toStart.value[0]?.id).toBe('x');
    expect(reorderTask(chain, 'nope', 0)).toMatchObject({ ok: false });
  });
});

describe('delayTask', () => {
  it('ripples only downstream tasks, only as far as needed, with reasons', () => {
    const result = delayTask(chain, 'a', 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const due = Object.fromEntries(result.value.tasks.map((t) => [t.id, t.dueISO]));
    expect(due).toEqual({ a: '2027-01-15', b: '2027-01-15', c: '2027-01-15', x: '2027-01-11' });
    // c was already due 2027-01-15, the same day b moves to, so it has enough slack and stays put.
    expect(result.value.changes.map((c) => c.taskId)).toEqual(['a', 'b']);
    expect(result.value.changes[1]?.reason).toContain('"Task a" is now due 2027-01-15');
  });
  it('keeps rippling down the chain when the delay is long enough', () => {
    const result = delayTask(chain, 'a', 8);
    expect(result.ok && result.value.changes.map((c) => c.taskId)).toEqual(['a', 'b', 'c']);
    expect(result.ok && result.value.changes[2]?.reason).toContain(
      '"Task b" is now due 2027-01-18',
    );
  });
  it('does not move a dependant that already has enough slack', () => {
    const result = delayTask(chain, 'a', 1);
    expect(result.ok && result.value.changes.map((c) => c.taskId)).toEqual(['a']);
  });
  it('leaves completed dependants alone', () => {
    const withDone = [task('a', '2027-01-10'), task('b', '2027-01-11', ['a'], true)];
    const result = delayTask(withDone, 'a', 10);
    expect(result.ok && result.value.tasks.find((t) => t.id === 'b')?.dueISO).toBe('2027-01-11');
  });
  it('supports pulling a task earlier and rejects bad input', () => {
    const earlier = delayTask(chain, 'a', -3);
    expect(earlier.ok && earlier.value.tasks.find((t) => t.id === 'a')?.dueISO).toBe('2027-01-07');
    expect(delayTask(chain, 'a', 1.5)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_DAYS' },
    });
    expect(delayTask(chain, 'nope', 1)).toMatchObject({
      ok: false,
      error: { code: 'TASK_NOT_FOUND' },
    });
    expect(delayTask([task('a', '2200-12-31')], 'a', 5)).toMatchObject({
      ok: false,
      error: { code: 'DATE_OUT_OF_RANGE' },
    });
  });
  it('picks the latest of several blockers', () => {
    const diamond = [
      task('a', '2027-01-01'),
      task('b', '2027-01-02', ['a']),
      task('c', '2027-01-03', ['a']),
      task('d', '2027-01-04', ['b', 'c']),
    ];
    const result = delayTask(diamond, 'a', 30);
    const d = result.ok ? result.value.tasks.find((t) => t.id === 'd') : undefined;
    expect(d?.dueISO).toBe('2027-01-31');
  });
  it('ignores tasks trapped in a cycle in imported data instead of looping', () => {
    const cyclic = [task('a', '2027-01-01', ['b']), task('b', '2027-01-02', ['a'])];
    expect(delayTask(cyclic, 'a', 3)).toMatchObject({ ok: true });
  });
  it('property: after a delay, no moved task is due before anything it depends on that also moved, and unrelated tasks are unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -20, max: 60 }),
        (index, days) => {
          const id = ['a', 'b', 'c', 'x'][index] ?? 'a';
          const result = delayTask(chain, id, days);
          if (!result.ok) return false;
          const movedIds = new Set(result.value.changes.map((c) => c.taskId));
          const after = new Map(result.value.tasks.map((t) => [t.id, t.dueISO]));
          const consistent = result.value.tasks.every(
            (t) =>
              !movedIds.has(t.id) ||
              t.id === id ||
              t.dependsOn.every((d) => !movedIds.has(d) || (after.get(d) ?? '') <= t.dueISO),
          );
          const untouched = chain
            .filter((t) => !movedIds.has(t.id))
            .every((t) => after.get(t.id) === t.dueISO);
          return consistent && untouched;
        },
      ),
    );
  });
});

describe('error details the UI relies on', () => {
  it('every failure names its field and carries a readable message', () => {
    expectFailure(setDependencies(chain, 'zzz', []), 'TASK_NOT_FOUND', 'taskId');
    expectFailure(setDependencies(chain, 'x', ['nope']), 'DEPENDENCY_NOT_FOUND', 'dependsOn');
    expectFailure(setDependencies(chain, 'a', ['c']), 'DEPENDENCY_CYCLE', 'dependsOn');
    const many = Array.from({ length: 11 }, (_, i) => task(`t${i}`, '2027-01-01'));
    expectFailure(
      setDependencies(
        [...many, task('z', '2027-01-02')],
        'z',
        many.map((t) => t.id),
      ),
      'TOO_MANY_DEPENDENCIES',
      'dependsOn',
    );
    expectFailure(removeTask(chain, 'nope'), 'TASK_NOT_FOUND', 'taskId');
    expectFailure(reorderTask(chain, 'nope', 0), 'TASK_NOT_FOUND', 'taskId');
    expectFailure(delayTask(chain, 'nope', 1), 'TASK_NOT_FOUND', 'taskId');
    expectFailure(delayTask(chain, 'a', 0.5), 'INVALID_DAYS', 'days');
    expectFailure(delayTask([task('a', '2200-12-31')], 'a', 5), 'DATE_OUT_OF_RANGE', 'days');
  });
  it('allows exactly ten dependencies', () => {
    const ten = Array.from({ length: 10 }, (_, i) => task(`t${i}`, '2027-01-01'));
    expect(
      setDependencies(
        [...ten, task('z', '2027-01-02')],
        'z',
        ten.map((t) => t.id),
      ).ok,
    ).toBe(true);
  });
  it('names the delay in the first change', () => {
    const result = delayTask(chain, 'a', 3);
    expect(result.ok && result.value.changes[0]?.reason).toBe('Delayed by 3 day(s).');
  });
});

describe('graph robustness', () => {
  it('terminates on cyclic imported data instead of looping', () => {
    const cyclic = [
      task('a', '2027-01-01', ['b']),
      task('b', '2027-01-02', ['a']),
      task('z', '2027-01-03'),
    ];
    expect(wouldCreateCycle(cyclic, 'z', ['a'])).toBe(false);
  });
  it("keeps a dependant's other prerequisites when one is removed", () => {
    const tasks = [
      task('a', '2027-01-01'),
      task('b', '2027-01-02'),
      task('c', '2027-01-03', ['b', 'a']),
    ];
    const result = removeTask(tasks, 'b');
    expect(result.ok && result.value.tasks.find((t) => t.id === 'c')?.dependsOn).toEqual(['a']);
  });
  it('ripples correctly when tasks are listed dependants-first', () => {
    const backwards = [
      task('c', '2027-01-15', ['b']),
      task('b', '2027-01-12', ['a']),
      task('a', '2027-01-10'),
    ];
    const result = delayTask(backwards, 'a', 8);
    const due = result.ok
      ? Object.fromEntries(result.value.tasks.map((t) => [t.id, t.dueISO]))
      : {};
    expect(due).toEqual({ a: '2027-01-18', b: '2027-01-18', c: '2027-01-18' });
  });
  it('leaves tasks trapped in a cycle exactly where they were', () => {
    const cyclic = [
      task('s', '2027-01-01'),
      task('a', '2027-01-02', ['b', 's']),
      task('b', '2027-01-03', ['a']),
    ];
    const result = delayTask(cyclic, 's', 30);
    expect(result.ok && result.value.tasks.map((t) => t.dueISO)).toEqual([
      '2027-01-31',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
  it('names the first moved prerequisite as the reason when several apply', () => {
    const diamond = [
      task('a', '2027-01-01'),
      task('b', '2027-01-02', ['a']),
      task('c', '2027-01-03', ['a']),
      task('d', '2027-01-04', ['b', 'c']),
    ];
    const result = delayTask(diamond, 'a', 30);
    const reason = result.ok ? result.value.changes.find((c) => c.taskId === 'd')?.reason : '';
    expect(reason).toContain('"Task b"');
  });
});
