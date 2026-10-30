import { MAX_DEPENDENCIES_PER_TASK, MAX_TASKS } from '../../config/limits.js';
import { delayTask, removeTask, reorderTask, setDependencies } from '../tasks.js';
import { fail, ok, type Result } from '../result.js';
import type { Plan, Task } from '../types.js';
import { checkDate, checkId, checkName, checkStringList } from '../validate.js';

export function addTask(plan: Plan, input: Omit<Task, 'done'>): Result<Plan> {
  const id = checkId(input.id, 'id');
  if (!id.ok) return id;
  const title = checkName(input.title, 'title', 'Task title');
  if (!title.ok) return title;
  const date = checkDate(input.dueISO, 'dueISO');
  if (!date.ok) return date;
  const assigneeRaw: unknown = input.assignee;
  const assignee =
    assigneeRaw === null || assigneeRaw === undefined
      ? ok(null)
      : checkName(assigneeRaw, 'assignee', 'Assignee');
  if (!assignee.ok) return assignee;
  const dependsOn = checkStringList(
    input.dependsOn,
    'dependsOn',
    'Dependencies',
    MAX_DEPENDENCIES_PER_TASK,
  );
  if (!dependsOn.ok) return dependsOn;
  if (plan.tasks.length >= MAX_TASKS)
    return fail('TOO_MANY_TASKS', `A plan can have at most ${MAX_TASKS} tasks.`);
  if (plan.tasks.some((t) => t.id === input.id))
    return fail('DUPLICATE_ID', 'That task already exists.', 'id');
  const task: Task = {
    id: input.id,
    title: title.value,
    dueISO: date.value,
    dependsOn: [],
    assignee: assignee.value,
    done: false,
  };
  const withTask = { ...plan, tasks: [...plan.tasks, task] };
  const linked = setDependencies(withTask.tasks, input.id, dependsOn.value);
  return linked.ok ? ok({ ...plan, tasks: linked.value }) : linked;
}

export function updateTask(
  plan: Plan,
  id: string,
  changes: { title?: string; dueISO?: string; assignee?: string | null; done?: boolean },
): Result<Plan> {
  const current = plan.tasks.find((t) => t.id === id);
  if (!current) return fail('TASK_NOT_FOUND', 'That task no longer exists.', 'id');
  let next: Task = current;
  if (changes.title !== undefined) {
    const title = checkName(changes.title, 'title', 'Task title');
    if (!title.ok) return title;
    next = { ...next, title: title.value };
  }
  if (changes.dueISO !== undefined) {
    const date = checkDate(changes.dueISO, 'dueISO');
    if (!date.ok) return date;
    next = { ...next, dueISO: date.value };
  }
  if (changes.assignee !== undefined) {
    if (changes.assignee === null) next = { ...next, assignee: null };
    else {
      const assignee = checkName(changes.assignee, 'assignee', 'Assignee');
      if (!assignee.ok) return assignee;
      next = { ...next, assignee: assignee.value };
    }
  }
  if (changes.done !== undefined) {
    if (typeof changes.done !== 'boolean')
      return fail('INVALID_VALUE', 'Done must be true or false.', 'done');
    next = { ...next, done: changes.done };
  }
  return ok({ ...plan, tasks: plan.tasks.map((t) => (t.id === id ? next : t)) });
}

export function deleteTask(plan: Plan, id: string): Result<Plan> {
  const removed = removeTask(plan.tasks, id);
  return removed.ok ? ok({ ...plan, tasks: removed.value.tasks }) : removed;
}

export function setTaskDependencies(
  plan: Plan,
  id: string,
  dependsOn: readonly string[],
): Result<Plan> {
  const result = setDependencies(plan.tasks, id, dependsOn);
  return result.ok ? ok({ ...plan, tasks: result.value }) : result;
}

export function moveTask(plan: Plan, id: string, toIndex: number): Result<Plan> {
  const result = reorderTask(plan.tasks, id, toIndex);
  return result.ok ? ok({ ...plan, tasks: result.value }) : result;
}

export function delayPlanTask(plan: Plan, id: string, days: number): Result<Plan> {
  const result = delayTask(plan.tasks, id, days);
  return result.ok ? ok({ ...plan, tasks: result.value.tasks }) : result;
}
