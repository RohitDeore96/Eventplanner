import type { PlanAction, ReduceContext } from './actions';
import {
  addCategory,
  addExpense,
  deleteCategory,
  deleteExpense,
  moveBudget,
  updateCategory,
  updateExpense,
} from './reducers/budget';
import { updateEvent } from './reducers/event';
import { addGuest, deleteGuest, updateGuest } from './reducers/guests';
import {
  addTask,
  delayPlanTask,
  deleteTask,
  moveTask,
  setTaskDependencies,
  updateTask,
} from './reducers/tasks';
import { addVendor, deleteVendor, setSchedule, updateVendor } from './reducers/vendors';
import type { Result } from './result';
import type { Plan } from './types';

type ActionOf<T extends PlanAction['type']> = Extract<PlanAction, { type: T }>;
type Handlers = {
  [T in PlanAction['type']]: (
    plan: Plan,
    action: ActionOf<T>,
    context: ReduceContext,
  ) => Result<Plan>;
};

/** One handler per action type. The mapped type makes a missing handler a compile error. */
const handlers: Handlers = {
  'event/update': (plan, a, c) => updateEvent(plan, a.changes, c.today),
  'category/add': (plan, a) => addCategory(plan, a.id, a.name, a.plannedMinor),
  'category/update': (plan, a) => updateCategory(plan, a.id, a.name, a.plannedMinor),
  'category/delete': (plan, a) => deleteCategory(plan, a.id),
  'budget/move': (plan, a) => moveBudget(plan, a.fromId, a.toId, a.amountMinor),
  'task/add': (plan, a) => addTask(plan, a),
  'task/update': (plan, a) => updateTask(plan, a.id, a),
  'task/delete': (plan, a) => deleteTask(plan, a.id),
  'task/setDependencies': (plan, a) => setTaskDependencies(plan, a.id, a.dependsOn),
  'task/reorder': (plan, a) => moveTask(plan, a.id, a.toIndex),
  'task/delay': (plan, a) => delayPlanTask(plan, a.id, a.days),
  'vendor/add': (plan, a) => addVendor(plan, a),
  'vendor/update': (plan, a) => updateVendor(plan, a.id, a),
  'vendor/delete': (plan, a) => deleteVendor(plan, a.id),
  'vendor/setSchedule': (plan, a) => setSchedule(plan, a.id, a.schedule),
  'expense/add': (plan, a) => addExpense(plan, a),
  'expense/update': (plan, a) => updateExpense(plan, a.id, a),
  'expense/delete': (plan, a) => deleteExpense(plan, a.id),
  'guest/add': (plan, a) => addGuest(plan, a),
  'guest/update': (plan, a) => updateGuest(plan, a.id, a),
  'guest/delete': (plan, a) => deleteGuest(plan, a.id),
};

/**
 * The only way a plan changes. Pure: same plan + action + context always yields the same result,
 * and invalid actions return an error instead of throwing. Manual edits and accepted AI patches
 * both come through here.
 */
export function reducePlan(plan: Plan, action: PlanAction, context: ReduceContext): Result<Plan> {
  const handler = handlers[action.type] as (
    p: Plan,
    a: PlanAction,
    c: ReduceContext,
  ) => Result<Plan>;
  return handler(plan, action, context);
}
