import { currencyExponent } from '../../../engine/money';
import type { BookingStatus, PaymentKind, Plan } from '../../../engine/types';

/** Minor -> major for small inline inputs, with the plan currency's own exponent. */
export function displayMajor(minor: number, plan: Plan): string {
  const exponent = currencyExponent(plan.currency) ?? 2;
  return String(Math.round(minor / 10 ** exponent));
}

export const STATUS_OPTIONS: readonly { readonly value: BookingStatus; readonly label: string }[] =
  [
    { value: 'not_started', label: 'Not started' },
    { value: 'contacted', label: 'Contacted' },
    { value: 'quoted', label: 'Quotation received' },
    { value: 'booked', label: 'Booked' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

export const KIND_LABELS: Record<PaymentKind, string> = {
  advance: 'Advance',
  instalment: 'Instalment',
  milestone: 'Milestone',
  final: 'Final payment',
  balance: 'Balance',
  custom: 'Custom',
};
