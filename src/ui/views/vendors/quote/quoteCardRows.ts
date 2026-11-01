import type { Plan } from '../../../../engine/types';
import { money } from '../../../../lib/format';
import {
  effectiveMinor,
  inquiryMessage,
  missingFields,
  riskFlags,
} from '../../../../lib/quoteCompare';
import type { SavedQuote } from '../../../../state/quotes';

/**
 * The comparison numbers and cell wording for one saved quotation, computed outside JSX so
 * the card component only renders. "Not stated" is the shared wording for every optional
 * term; under/over amounts are exact, never colour alone.
 */

/** The advance cell: percent, plus the amount when the effective price is known. */
function advanceLabel(fields: SavedQuote['fields'], effective: number | null, plan: Plan): string {
  if (fields.advancePercent === null) return 'Not stated';
  if (effective === null) return `${fields.advancePercent}%`;
  const amount = Math.round((effective * fields.advancePercent) / 100);
  return `${fields.advancePercent}% (${money(amount, plan)})`;
}

/** The vs-budget cell: under/over with exact amounts, never colour alone. */
function budgetLabel(gap: number | null, plan: Plan): string {
  if (gap === null) return '—';
  return gap >= 0 ? `${money(gap, plan)} under` : `${money(-gap, plan)} over`;
}

/** "Not stated" for optional values; shared wording across the comparison rows. */
function statedText<T>(value: T | null, render: (value: T) => string): string {
  return value === null ? 'Not stated' : render(value);
}

function yesNoLabel(value: boolean | null): string {
  return value === null ? 'Not stated' : value ? 'Yes' : 'No';
}

/** The comparison numbers for one quotation, computed outside JSX. */
export function quoteCardRows(
  plan: Plan,
  quote: SavedQuote,
): {
  readonly rows: readonly { readonly label: string; readonly value: string }[];
  readonly effective: number | null;
  readonly flags: readonly string[];
  readonly missing: readonly string[];
  readonly inquiry: string;
} {
  const fields = quote.fields;
  const effective = effectiveMinor(fields, plan.guestTarget);
  const category = plan.categories.find((c) => c.id === quote.categoryId);
  const perGuest =
    effective === null || plan.guestTarget === 0 ? null : Math.round(effective / plan.guestTarget);
  const budgetGap =
    effective === null || category === undefined ? null : category.plannedMinor - effective;
  const missing = missingFields(fields);
  return {
    effective,
    flags: riskFlags(fields, plan),
    missing,
    inquiry: inquiryMessage(fields, missing),
    rows: [
      {
        label: 'Stated total',
        value: statedText(fields.totalPriceMinor, (total) => money(total, plan)),
      },
      {
        label: `Effective for ${plan.guestTarget} guests`,
        value: effective === null ? 'Cannot compute' : money(effective, plan),
      },
      { label: 'Cost per guest', value: perGuest === null ? '—' : money(perGuest, plan) },
      { label: 'Vs category budget', value: budgetLabel(budgetGap, plan) },
      { label: 'Advance', value: advanceLabel(fields, effective, plan) },
      {
        label: 'Tax included',
        value: yesNoLabel(fields.taxIncluded),
      },
      {
        label: 'Min. guests',
        value: statedText(fields.guestMinimum, String),
      },
    ],
  };
}
