import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
import { formatMoney } from '../engine/money';

/**
 * A compact, factual text rendering of the plan for the AI endpoints. Built ONLY from
 * engine output: the model sees the same numbers the family sees, and nothing else.
 */
export function planFacts(plan: Plan, today: string): string {
  const summary = summarize(plan, today);
  const money = (minor: number): string => formatMoney(minor, plan.currency, plan.locale);
  const lines: string[] = [
    `Event: ${plan.name} (${plan.occasion}) on ${plan.dateISO}.`,
    `Budget: ${money(summary.totals.budget)}; planned ${money(summary.totals.planned)}; committed ${money(summary.totals.committed)}; paid ${money(summary.totals.paid)}; remaining budget ${money(summary.totals.remaining)}.`,
    `Guests: target ${plan.guestTarget}; catering headcount ${summary.catering.headcount} (${summary.catering.basis}).`,
    `Dietary (confirmed guests only): ${
      Object.keys(summary.catering.dietary).length === 0
        ? 'none recorded'
        : Object.entries(summary.catering.dietary)
            .map(([tag, count]) => `${tag} ${count}`)
            .join(', ')
    }.`,
    `RSVP: ${plan.guests.filter((g) => g.rsvp === 'yes').length} yes, ${plan.guests.filter((g) => g.rsvp === 'pending').length} pending, ${plan.guests.filter((g) => g.rsvp === 'no').length} no.`,
    `Categories: ${summary.categories
      .map(
        (c) =>
          `${c.name} planned ${money(c.planned)}${c.remaining < 0 ? ` (over by ${money(-c.remaining)})` : ''}`,
      )
      .join('; ')}.`,
    `Tasks: ${summary.readiness.tasksDone}/${summary.readiness.tasksTotal} done; ${summary.readiness.overdue} overdue; ${summary.readiness.daysToEvent ?? '?'} days to the event.`,
    `Warnings: ${summary.warnings.length === 0 ? 'none' : summary.warnings.map((w) => `${w.severity}: ${w.message}`).join(' | ')}`,
  ];
  if (plan.vendors.length > 0) {
    lines.push(
      `Vendors: ${plan.vendors
        .map(
          (v) =>
            `${v.name} (${v.status}${v.committedMinor === null ? '' : `, agreed ${money(v.committedMinor)}`})`,
        )
        .join('; ')}.`,
    );
  }
  return lines.join('\n');
}
