import type { PlanAction } from '../engine/actions';
import type { Plan } from '../engine/types';
import type { QuoteFields } from '../schemas/ai';
import type { SavedQuote } from '../state/quotes';

/**
 * Deterministic quotation comparison. Every number comes from the extracted fields or the
 * plan; nothing is invented. A quote with neither a stated total nor a per-plate rate has no
 * effective price and cannot be accepted.
 */

export function effectiveMinor(fields: QuoteFields, guestTarget: number): number | null {
  const { totalPriceMinor, pricePerPlateMinor } = fields;
  if (pricePerPlateMinor !== null && pricePerPlateMinor > 0) {
    return pricePerPlateMinor * guestTarget;
  }
  return totalPriceMinor;
}

const FIELD_LABELS: readonly { readonly key: keyof QuoteFields; readonly label: string }[] = [
  { key: 'totalPriceMinor', label: 'total price' },
  { key: 'pricePerPlateMinor', label: 'per-plate rate' },
  { key: 'guestMinimum', label: 'minimum guests' },
  { key: 'taxIncluded', label: 'tax inclusion' },
  { key: 'advancePercent', label: 'advance requirement' },
  { key: 'cancellationPolicy', label: 'cancellation policy' },
];

export function missingFields(fields: QuoteFields): string[] {
  return FIELD_LABELS.filter(({ key }) => fields[key] === null).map(({ label }) => label);
}

export function riskFlags(fields: QuoteFields, plan: Plan): string[] {
  const flags: string[] = [];
  const { guestMinimum, advancePercent, taxIncluded, cancellationPolicy } = fields;
  if (guestMinimum !== null && guestMinimum > plan.guestTarget) {
    flags.push(`Minimum ${guestMinimum} plates is above your ${plan.guestTarget} guests.`);
  }
  if (advancePercent !== null && advancePercent > 50) {
    flags.push(`Advance ${advancePercent}% is high (above 50%).`);
  }
  if (taxIncluded === false) flags.push('Tax is not included — budget for GST on top.');
  if (cancellationPolicy === null) flags.push('No cancellation policy stated.');
  return flags;
}

/** A polite, specific message the family can send the vendor about the gaps. */
export function inquiryMessage(fields: QuoteFields, missing: readonly string[]): string {
  if (missing.length === 0) {
    return `Hello${namePart(fields)}! Thank you for the quotation. Could you please confirm it in writing so we can proceed?`;
  }
  return [
    `Hello${namePart(fields)}! Thank you for the quotation.`,
    'Before we decide, could you please clarify:',
    ...missing.map((field) => `- ${field}`),
    'Thank you!',
  ].join('\n');
}

function namePart(fields: QuoteFields): string {
  const vendor = fields.vendorName;
  return vendor === null ? '' : ` ${vendor}`;
}

/**
 * The engine actions that make an accepted quotation REAL: the vendor (found by name in the
 * category, or added) becomes booked at the effective price. Applied through the reducer,
 * so warnings, committed totals and undo all work like any other change.
 */
export function acceptActions(plan: Plan, quote: SavedQuote): PlanAction[] | null {
  const effective = effectiveMinor(quote.fields, plan.guestTarget);
  if (effective === null) return null;
  const categoryId = quote.categoryId;
  if (!plan.categories.some((c) => c.id === categoryId)) return null;
  const name = quote.fields.vendorName ?? 'Quoted vendor';
  const existing = plan.vendors.find(
    (v) => v.categoryId === categoryId && v.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (existing === undefined) {
    return [
      {
        type: 'vendor/add',
        id: `v-${Date.now().toString(36)}`,
        categoryId,
        name,
        contactNote: 'Added from an accepted quotation.',
        status: 'booked',
        committedMinor: effective,
      },
    ];
  }
  return [
    {
      type: 'vendor/update',
      id: existing.id,
      status: 'booked',
      committedMinor: effective,
    },
  ];
}
