import { BPS_TOTAL, CONTINGENCY_KEY, CONTINGENCY_MIN_BPS } from '../config/limits.js';
import {
  budgetTotals,
  categoryFigures,
  instalmentPayments,
  type VendorPayments,
  vendorPayments,
} from './budget.js';
import { daysBetween, type ISODate } from './dates.js';
import { headcount } from './guests.js';
import { formatMoney } from './money.js';
import type { Plan, Vendor } from './types.js';

type Severity = 'error' | 'warning' | 'info';

export interface Warning {
  /** Stable code plus subject, e.g. "CATEGORY_OVERSPENT:cat-venue". Used to diff before/after. */
  readonly id: string;
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  /** Plain-language suggestion. The engine never applies it. */
  readonly fix: string;
}

type Money = (minor: number) => string;

function budgetWarnings(plan: Plan, money: Money, payments: VendorPayments): Warning[] {
  const totals = budgetTotals(plan, payments);
  const out: Warning[] = [];
  if (totals.planned > plan.budgetMinor) {
    out.push({
      id: 'OVER_ALLOCATED',
      code: 'OVER_ALLOCATED',
      severity: 'error',
      message: `Category plans add up to ${money(totals.planned)}, which is ${money(totals.planned - plan.budgetMinor)} more than your budget.`,
      fix: 'Reduce one or more category plans, or raise the total budget.',
    });
  }
  if (totals.committed > plan.budgetMinor) {
    out.push({
      id: 'OVER_COMMITTED',
      code: 'OVER_COMMITTED',
      severity: 'error',
      message: `You have committed ${money(totals.committed)} against a budget of ${money(plan.budgetMinor)}.`,
      fix: 'Renegotiate a booking, cancel a vendor, or raise the budget.',
    });
  }
  return out;
}

function categoryWarnings(plan: Plan, money: Money, payments: VendorPayments): Warning[] {
  const out: Warning[] = [];
  for (const category of plan.categories) {
    const { committed } = categoryFigures(plan, category, payments);
    if (committed > category.plannedMinor) {
      out.push({
        id: `CATEGORY_OVERSPENT:${category.id}`,
        code: 'CATEGORY_OVERSPENT',
        severity: 'warning',
        message: `${category.name} is ${money(committed - category.plannedMinor)} over its plan.`,
        fix: `Move money into ${category.name} from a category with room, or choose a cheaper option.`,
      });
    }
  }
  const minimum = Math.floor((plan.budgetMinor * CONTINGENCY_MIN_BPS) / BPS_TOTAL);
  const contingency = plan.categories.find((c) => c.key === CONTINGENCY_KEY)?.plannedMinor ?? 0;
  if (plan.budgetMinor > 0 && contingency < minimum) {
    out.push({
      id: 'THIN_CONTINGENCY',
      code: 'THIN_CONTINGENCY',
      severity: 'warning',
      message: `Your contingency is below ${CONTINGENCY_MIN_BPS / 100}% of the budget.`,
      fix: `Set aside at least ${money(minimum)} for surprises.`,
    });
  }
  return out;
}

interface VendorContext {
  readonly plan: Plan;
  readonly today: ISODate;
  readonly money: Money;
  readonly payments: VendorPayments;
  /** Money paid against each instalment id; an instalment settles when payments reach its amount. */
  readonly instalmentPaid: ReadonlyMap<string, number>;
}

function vendorWarnings(
  vendor: Vendor,
  { today, money, payments, instalmentPaid }: VendorContext,
): Warning[] {
  const out: Warning[] = [];
  const paid = payments.get(vendor.id) ?? 0;
  const agreed = vendor.status === 'booked' ? (vendor.committedMinor ?? 0) : 0;
  if (paid > agreed) {
    out.push({
      id: `PAID_OVER_COMMITMENT:${vendor.id}`,
      code: 'PAID_OVER_COMMITMENT',
      severity: 'warning',
      message: `You have paid ${vendor.name} ${money(paid)}, more than the agreed ${money(agreed)}.`,
      fix: 'Check the agreed price or ask the vendor about a refund or credit.',
    });
  }
  const scheduled = vendor.schedule.reduce((acc, i) => acc + i.amountMinor, 0);
  if (agreed > 0 && scheduled > agreed) {
    out.push({
      id: `SCHEDULE_EXCEEDS_COMMITMENT:${vendor.id}`,
      code: 'SCHEDULE_EXCEEDS_COMMITMENT',
      severity: 'warning',
      message: `${vendor.name}'s payment schedule totals ${money(scheduled)}, above the agreed ${money(agreed)}.`,
      fix: 'Adjust an instalment so the schedule matches the agreed price.',
    });
  }
  for (const instalment of vendor.schedule) {
    const settled = instalmentPaid.get(instalment.id) ?? 0;
    const late = daysBetween(instalment.dueISO, today) ?? 0;
    if (settled < instalment.amountMinor && late > 0) {
      out.push({
        id: `PAYMENT_OVERDUE:${instalment.id}`,
        code: 'PAYMENT_OVERDUE',
        severity: 'error',
        message: `${vendor.name}: ${money(instalment.amountMinor - settled)} of ${money(instalment.amountMinor)} was due ${instalment.dueISO}.`,
        fix: 'Pay the balance, or ask the vendor to agree a new date and update the schedule.',
      });
    }
    if (settled > instalment.amountMinor) {
      out.push({
        id: `INSTALMENT_OVERPAID:${instalment.id}`,
        code: 'INSTALMENT_OVERPAID',
        severity: 'warning',
        message: `${vendor.name} has received ${money(settled)} against a scheduled payment of ${money(instalment.amountMinor)}.`,
        fix: 'Check the schedule, or ask the vendor for a refund or credit.',
      });
    }
  }
  return out;
}

function guestWarnings(plan: Plan): Warning[] {
  const { confirmed } = headcount(plan.guests);
  return confirmed > plan.guestTarget
    ? [
        {
          id: 'CONFIRMED_ABOVE_TARGET',
          code: 'CONFIRMED_ABOVE_TARGET',
          severity: 'warning',
          message: `${confirmed} guests have confirmed, ${confirmed - plan.guestTarget} above your target of ${plan.guestTarget}.`,
          fix: 'Check the venue capacity and tell your caterer the new number.',
        },
      ]
    : [];
}

function taskWarnings(plan: Plan, today: ISODate): Warning[] {
  return plan.tasks
    .filter((t) => !t.done && (daysBetween(t.dueISO, today) ?? 0) > 0)
    .map((t) => ({
      id: `TASK_OVERDUE:${t.id}`,
      code: 'TASK_OVERDUE',
      severity: 'warning' as const,
      message: `"${t.title}" was due ${t.dueISO}.`,
      fix: 'Finish it, or delay it and see what else moves.',
    }));
}

/** Every problem the plan currently has, each with a plain-language fix. Nothing is auto-applied. */
export function computeWarnings(plan: Plan, today: ISODate): Warning[] {
  const money: Money = (minor) => formatMoney(minor, plan.currency, plan.locale);
  const payments = vendorPayments(plan.expenses);
  const instalmentPaid = instalmentPayments(plan.expenses);
  const context: VendorContext = { plan, today, money, payments, instalmentPaid };
  return [
    ...budgetWarnings(plan, money, payments),
    ...categoryWarnings(plan, money, payments),
    ...plan.vendors.flatMap((v) => vendorWarnings(v, context)),
    ...guestWarnings(plan),
    ...taskWarnings(plan, today),
  ];
}
