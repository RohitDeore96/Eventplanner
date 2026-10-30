import { useState } from 'react';
import { dryRunPatch, type PatchAction, type PlanPatch } from '../../engine/patch';
import type { Plan } from '../../engine/types';
import { localToday, money } from '../../lib/format';
import { planFacts } from '../../lib/facts';
import { aiClient } from '../../lib/aiClient';
import { patchActionsFromProposal } from '../../schemas/patchBridge';
import { usePlan } from '../../state/store';

/**
 * X1 — the differentiated AI flow: AI proposes -> the ENGINE dry-runs in the browser ->
 * the family sees the exact before/after -> accept (one undo step) or reject.
 * The AI never writes the plan directly.
 */
export function AiPatchPanel({ plan }: { plan: Plan }) {
  const store = usePlan();
  const today = localToday();
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<{ patch: PlanPatch; blocked: boolean } | null>(null);

  async function propose() {
    setBusy(true);
    setNotice(null);
    setPending(null);
    try {
      const reply = await aiClient.proposePatch(instruction, planFacts(plan, today), today);
      const proposal = reply.body;
      const actions: PatchAction[] = patchActionsFromProposal(proposal);
      const patch: PlanPatch = { summary: proposal.summary, actions };
      const dry = dryRunPatch(plan, patch, today);
      if (!dry.ok) {
        setNotice(`The suggestion could not be applied: ${dry.error.message}`);
        return;
      }
      setPending({ patch, blocked: dry.value.blockedBy.length > 0 });
    } catch (error) {
      setNotice(
        error instanceof Error && error.message === 'AI_UNAVAILABLE'
          ? 'AI suggestions are offline (no key configured). Plan by hand — everything works.'
          : 'The suggestion service is unavailable. Try again later.',
      );
    } finally {
      setBusy(false);
    }
  }

  const dry = pending === null ? null : dryRunPatch(plan, pending.patch, today);

  return (
    <section className="card" aria-labelledby="ai-patch-title">
      <h2 id="ai-patch-title">Ask AI to suggest changes</h2>
      <p className="muted">
        AI proposes, the engine checks every change, and nothing is applied until you approve it.
      </p>
      <label htmlFor="ai-instruction">What would you like to change?</label>
      <input
        id="ai-instruction"
        value={instruction}
        maxLength={400}
        placeholder="e.g. add the haldi ceremony tasks and move 20,000 from decor to catering"
        onChange={(event) => {
          setInstruction(event.target.value);
        }}
      />
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={() => {
            void propose();
          }}
          disabled={busy || instruction.trim().length === 0}
        >
          {busy ? 'Thinking…' : 'Suggest changes'}
        </button>
        {notice !== null && (
          <p className="muted" role="status">
            {notice}
          </p>
        )}
      </div>
      {dry?.ok && pending !== null && (
        <div aria-live="polite">
          <h3>{pending.patch.summary}</h3>
          <table>
            <caption className="visually-hidden">Before and after for each category</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Planned before</th>
                <th scope="col">Planned after</th>
              </tr>
            </thead>
            <tbody>
              {dry.value.comparison.categories
                .filter((row) => row.plannedBefore !== row.plannedAfter)
                .map((row) => (
                  <tr key={row.categoryId}>
                    <th scope="row">{row.name}</th>
                    <td>{money(row.plannedBefore, plan)}</td>
                    <td>{money(row.plannedAfter, plan)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {dry.value.comparison.tasksAdded.length > 0 && (
            <p>Tasks added: {dry.value.comparison.tasksAdded.join(', ')}</p>
          )}
          {dry.value.comparison.tasksRescheduled.length > 0 && (
            <p>
              Rescheduled:{' '}
              {dry.value.comparison.tasksRescheduled
                .map((task) => `${task.title} → ${task.to}`)
                .join(', ')}
            </p>
          )}
          {pending.blocked ? (
            <div className="alert error" role="alert">
              <strong>
                <span aria-hidden="true">⛔</span> Blocked: this suggestion would break the plan's
                budget rules.
              </strong>
              <p className="fix">{dry.value.blockedBy[0]?.message}</p>
            </div>
          ) : (
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => {
                  store.dispatch({ kind: 'patch', patch: pending.patch });
                  setPending(null);
                  setNotice('Applied. One undo step — use Undo above to take it back.');
                }}
              >
                Apply these changes
              </button>
              <button
                type="button"
                onClick={() => {
                  setPending(null);
                }}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
