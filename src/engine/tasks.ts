import { MAX_DEPENDENCIES_PER_TASK } from '../config/limits.js';
import { addDays, type ISODate } from './dates.js';
import { fail, ok, type Result } from './result.js';
import type { Task } from './types.js';

export interface TaskChange {
  readonly taskId: string;
  readonly from: ISODate;
  readonly to: ISODate;
  readonly reason: string;
}

/** True if making `taskId` depend on `candidateIds` would create a cycle (including self-reference). */
export function wouldCreateCycle(
  tasks: readonly Task[],
  taskId: string,
  candidateIds: readonly string[],
): boolean {
  if (candidateIds.includes(taskId)) return true;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const stack = [...candidateIds];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) continue;
    if (current === taskId) return true;
    seen.add(current);
    stack.push(...(byId.get(current)?.dependsOn ?? []));
  }
  return false;
}

export function setDependencies(
  tasks: readonly Task[],
  taskId: string,
  dependsOn: readonly string[],
): Result<Task[]> {
  if (!tasks.some((t) => t.id === taskId))
    return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'taskId');
  const unique = [...new Set(dependsOn)];
  if (unique.length > MAX_DEPENDENCIES_PER_TASK) {
    return fail(
      'TOO_MANY_DEPENDENCIES',
      `A task can depend on at most ${MAX_DEPENDENCIES_PER_TASK} others.`,
      'dependsOn',
    );
  }
  const missing = unique.find((id) => !tasks.some((t) => t.id === id));
  if (missing !== undefined)
    return fail(
      'DEPENDENCY_NOT_FOUND',
      'One of the chosen dependencies does not exist.',
      'dependsOn',
    );
  if (wouldCreateCycle(tasks, taskId, unique)) {
    return fail(
      'DEPENDENCY_CYCLE',
      'That would make tasks wait on each other in a loop. Pick a different dependency.',
      'dependsOn',
    );
  }
  return ok(tasks.map((t) => (t.id === taskId ? { ...t, dependsOn: unique } : t)));
}

/** Removes a task and detaches it from anything that depended on it. */
export function removeTask(
  tasks: readonly Task[],
  taskId: string,
): Result<{ tasks: Task[]; detachedFrom: string[] }> {
  if (!tasks.some((t) => t.id === taskId))
    return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'taskId');
  const detachedFrom = tasks.filter((t) => t.dependsOn.includes(taskId)).map((t) => t.id);
  const remaining = tasks
    .filter((t) => t.id !== taskId)
    .map((t) =>
      t.dependsOn.includes(taskId)
        ? { ...t, dependsOn: t.dependsOn.filter((d) => d !== taskId) }
        : t,
    );
  return ok({ tasks: remaining, detachedFrom });
}

export function reorderTask(
  tasks: readonly Task[],
  taskId: string,
  toIndex: number,
): Result<Task[]> {
  const from = tasks.findIndex((t) => t.id === taskId);
  if (from < 0) return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'taskId');
  const target = Math.min(Math.max(Math.trunc(toIndex), 0), tasks.length - 1);
  const next = [...tasks];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'taskId');
  next.splice(target, 0, moved);
  return ok(next);
}

/** Tasks ordered so every task comes after the tasks it depends on. Tasks stuck in a cycle are omitted. */
function topologicalOrder(tasks: readonly Task[]): Task[] {
  const known = new Set(tasks.map((t) => t.id));
  const waiting = new Map(tasks.map((t) => [t.id, t.dependsOn.filter((d) => known.has(d)).length]));
  const ready = tasks.filter((t) => waiting.get(t.id) === 0);
  const ordered: Task[] = [];
  while (ready.length > 0) {
    const next = ready.shift();
    if (next === undefined) break;
    ordered.push(next);
    for (const task of tasks) {
      if (!task.dependsOn.includes(next.id)) continue;
      const remaining = (waiting.get(task.id) ?? 0) - 1;
      waiting.set(task.id, remaining);
      if (remaining === 0) ready.push(task);
    }
  }
  return ordered;
}

/**
 * Pushes a task's due date by `days` and ripples the change to everything downstream.
 * A dependant moves only as far as needed so it is never due before something it waits on,
 * unrelated tasks never move, and completed tasks are left alone. Every move carries a reason.
 */
export function delayTask(
  tasks: readonly Task[],
  taskId: string,
  days: number,
): Result<{ tasks: Task[]; changes: TaskChange[] }> {
  const start = tasks.find((t) => t.id === taskId);
  if (!start) return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'taskId');
  if (!Number.isInteger(days)) return fail('INVALID_DAYS', 'Enter a whole number of days.', 'days');
  const movedStart = addDays(start.dueISO, days);
  if (movedStart === null) {
    return fail('DATE_OUT_OF_RANGE', 'That delay moves the task outside supported dates.', 'days');
  }

  const due = new Map(tasks.map((t) => [t.id, t.dueISO]));
  due.set(taskId, movedStart);
  const moved = new Set([taskId]);
  const changes: TaskChange[] = [
    { taskId, from: start.dueISO, to: movedStart, reason: `Delayed by ${days} day(s).` },
  ];

  for (const task of topologicalOrder(tasks)) {
    if (task.done || moved.has(task.id)) continue;
    // Every task moved so far sits on the same new date, so any moved prerequisite is the blocker.
    const blocker = tasks.find((t) => moved.has(t.id) && task.dependsOn.includes(t.id));
    const blockerDue = blocker ? due.get(blocker.id) : undefined;
    if (blocker === undefined || blockerDue === undefined || blockerDue <= task.dueISO) continue;
    due.set(task.id, blockerDue);
    moved.add(task.id);
    changes.push({
      taskId: task.id,
      from: task.dueISO,
      to: blockerDue,
      reason: `Moved because "${blocker.title}" is now due ${blockerDue}.`,
    });
  }
  return ok({ tasks: tasks.map((t) => ({ ...t, dueISO: due.get(t.id) ?? t.dueISO })), changes });
}
