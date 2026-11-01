import { dietaryCounts } from '../../../engine/guests';
import { summarize } from '../../../engine/summary';
import type { DietaryTag, Plan } from '../../../engine/types';
import { money } from '../../../lib/format';
import { ALLERGY_TAGS, DIETARY_LABELS } from './shared';

/** The catering requirement: counts, per-head budget, dietary and allergy alerts. */
export function CateringSummary({
  plan,
  summary,
}: {
  plan: Plan;
  summary: ReturnType<typeof summarize>;
}) {
  const catering = summary.catering;
  const dietaryShown = Object.entries(dietaryCounts(plan.guests)).filter(([, count]) => count > 0);
  const allergyCount = plan.guests.filter(
    (guest) => guest.rsvp !== 'no' && guest.dietary.some((tag) => ALLERGY_TAGS.includes(tag)),
  ).length;
  const confirmedGuests = plan.guests.filter((guest) => guest.rsvp === 'yes').length;
  const pendingGuests = plan.guests.filter((guest) => guest.rsvp === 'pending').length;
  const declinedGuests = plan.guests.filter((guest) => guest.rsvp === 'no').length;
  return (
    <section className="card" aria-labelledby="catering-title">
      <h2 id="catering-title">Catering requirement</h2>
      <p>
        <strong>{catering.headcount}</strong> people to cater for (
        {catering.basis === 'confirmed'
          ? 'from confirmed RSVPs'
          : 'from your target — no RSVPs yet'}
        ).
        {catering.perHeadMinor !== null && (
          <span> Per-head budget: {money(catering.perHeadMinor, plan)}.</span>
        )}
      </p>
      <p className="muted">
        {plan.guests.length} invited · {confirmedGuests} confirmed · {pendingGuests} waiting for
        reply · {declinedGuests} declined
      </p>
      {dietaryShown.length > 0 && (
        <p className="muted">
          Dietary needs among confirmed guests (
          {dietaryShown
            .map(([tag, count]) => `${DIETARY_LABELS[tag as DietaryTag]} ×${count}`)
            .join(', ')}
          ). Plus-ones' needs are unknown — confirm them separately.
        </p>
      )}
      {allergyCount > 0 && (
        <div className="alert">
          <strong>
            <span aria-hidden="true">⚠️</span> {allergyCount} guest
            {allergyCount === 1 ? ' has' : 's have'} allergy-related needs
          </strong>{' '}
          (nut allergy, gluten-free or dairy-free). Tell the caterer explicitly.
        </div>
      )}
      {summary.warnings.some((w) => w.code === 'CONFIRMED_ABOVE_TARGET') && (
        <div className="alert">
          <strong>
            <span aria-hidden="true">⚠️</span> Warning: more guests have confirmed than your target.
          </strong>
        </div>
      )}
    </section>
  );
}
