import { useState } from 'react';
import { parseMajorAmount } from '../../../engine/money';
import { tradeOffActions, tradeOffFor, type TradeOffPlan } from '../../../engine/tradeoff';
import type { Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { usePlan } from '../../../state/store';

export /**
 * Trade-off planner (M10.3): fund one category without exceeding the budget. The plan is
 * shown first; applying runs the engine's own category/update actions as ONE undo step.
 */
function TradeOffCard({
  plan,
  onNotice,
}: {
  plan: Plan;
  onNotice: (notice: string | null) => void;
}) {
  const store = usePlan();
  const [toId, setToId] = useState(plan.categories[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [proposal, setProposal] = useState<TradeOffPlan | null>(null);

  function build(): void {
    const increase = parseMajorAmount(amount, plan.currency);
    if (increase === null) {
      onNotice('Enter the increase in major units, e.g. 50000.');
      setProposal(null);
      return;
    }
    const result = tradeOffFor(plan, toId, increase);
    if (!result.ok) {
      onNotice(result.error.message);
      setProposal(null);
      return;
    }
    setProposal(result.value);
    onNotice(null);
  }

  function apply(): void {
    if (proposal === null) return;
    const actions = tradeOffActions(proposal);
    const outcome = store.applyAll(
      actions,
      `Trade-off: ${proposal.toName} +${money(proposal.increaseMinor, plan)}`,
    );
    onNotice(
      outcome.ok
        ? `Trade-off applied as one undo step — ${proposal.toName} now has ${money(proposal.plannedAfter, plan)}.`
        : (outcome.message ?? 'The trade-off could not be applied.'),
    );
    setProposal(null);
    setAmount('');
  }

  return (
    <section className="card" aria-labelledby="tradeoff-title">
      <h2 id="tradeoff-title">Fund a category without overspending</h2>
      <p className="muted">
        Pick where the extra money should go; Utsav finds it from unallocated budget and the freest
        categories — locked categories and money already committed are never touched.
      </p>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          build();
        }}
      >
        <div>
          <label htmlFor="trade-to">Category to fund</label>
          <select
            id="trade-to"
            value={toId}
            onChange={(event) => {
              setToId(event.target.value);
              setProposal(null);
            }}
          >
            {plan.categories.map((c) => (
              <option key={c.id} value={c.id} disabled={c.locked}>
                {c.name}
                {c.locked ? ' (locked)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="trade-amount">Extra money needed</label>
          <input
            id="trade-amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
          />
        </div>
        <button type="submit" className="primary">
          Show the trade-off
        </button>
      </form>
      {proposal !== null && (
        <div aria-live="polite">
          <h3>
            Proposed: {proposal.toName} {money(proposal.plannedBefore, plan)} →{' '}
            {money(proposal.plannedAfter, plan)}{' '}
            <span className="muted">(nothing applied yet)</span>
          </h3>
          <ul>
            <li>
              From unallocated budget:{' '}
              {money(
                Math.min(Math.max(proposal.unallocatedBefore, 0), proposal.increaseMinor),
                plan,
              )}{' '}
              — {money(proposal.unallocatedAfter, plan)} unallocated afterwards.
            </li>
            {proposal.sources.map((source) => (
              <li key={source.categoryId}>
                {source.name}: {money(source.plannedBefore, plan)} →{' '}
                {money(source.plannedAfter, plan)} (has {money(source.slackMinor, plan)} not yet
                committed).
              </li>
            ))}
            {proposal.shortfallMinor > 0 && (
              <li>
                <strong>
                  {money(proposal.shortfallMinor, plan)} cannot be covered without breaking the
                  budget or touching locked/committed money — reduce the request or unlock a
                  category.
                </strong>
              </li>
            )}
          </ul>
          {proposal.shortfallMinor === 0 && (
            <button type="button" className="primary" onClick={apply}>
              Apply this trade-off
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setProposal(null);
            }}
          >
            Discard
          </button>
        </div>
      )}
    </section>
  );
}
