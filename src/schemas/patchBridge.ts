import type { PatchAction } from '../engine/patch';
import type { PatchProposal } from './ai';

/**
 * Converts an AI patch proposal into engine patch actions. Zod optionals carry explicit
 * `undefined`; the engine's PlanAction uses true optional keys (exactOptionalPropertyTypes),
 * so undefined fields are dropped rather than passed through.
 */
export function patchActionsFromProposal(proposal: PatchProposal): PatchAction[] {
  const out: PatchAction[] = [];
  for (const action of proposal.actions) {
    switch (action.type) {
      case 'task/add':
        out.push({
          type: 'task/add',
          id: action.id,
          title: action.title,
          dueISO: action.dueISO,
          dependsOn: action.dependsOn,
          assignee: action.assignee,
        });
        break;
      case 'task/update':
        out.push({
          type: 'task/update',
          id: action.id,
          ...(action.title !== undefined ? { title: action.title } : {}),
          ...(action.dueISO !== undefined ? { dueISO: action.dueISO } : {}),
          ...(action.assignee !== undefined ? { assignee: action.assignee } : {}),
          ...(action.done !== undefined ? { done: action.done } : {}),
        });
        break;
      case 'task/delay':
        out.push({ type: 'task/delay', id: action.id, days: action.days });
        break;
      case 'budget/move':
        out.push({
          type: 'budget/move',
          fromId: action.fromId,
          toId: action.toId,
          amountMinor: action.amountMinor,
        });
        break;
      case 'category/add':
        out.push({
          type: 'category/add',
          id: action.id,
          name: action.name,
          plannedMinor: action.plannedMinor,
        });
        break;
    }
  }
  return out;
}
