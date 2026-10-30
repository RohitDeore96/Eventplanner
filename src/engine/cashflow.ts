import { instalmentPayments } from './budget';
import type { ISODate } from './dates';
import type { Instalment, Plan } from './types';

/**
 * X8 cash-flow calendar: when does money actually leave the house? Every scheduled
 * instalment is placed in its due month with what has been paid against it (an expense
 * referencing the instalment settles it) and what is still to pay. Overdue items surface
 * first — that is the "overdue payments" line a family needs before anything else.
 */

interface CashflowEntry {
  readonly instalmentId: string;
  readonly vendorId: string;
  readonly vendorName: string;
  readonly kind: Instalment['kind'];
  readonly dueISO: ISODate;
  readonly amountMinor: number;
  /** Payments already recorded against this instalment. */
  readonly paidMinor: number;
  /** amount − paid, never negative. */
  readonly toPayMinor: number;
  /** Still to pay AND the due date has passed. */
  readonly overdue: boolean;
}

interface CashflowMonth {
  /** 'YYYY-MM' key, so the UI can format the label in the plan's locale. */
  readonly month: string;
  readonly entries: CashflowEntry[];
  readonly scheduledMinor: number;
  readonly toPayMinor: number;
}

export interface CashflowReport {
  readonly months: CashflowMonth[];
  /** Every entry still to pay whose due date has passed, earliest first. */
  readonly overdue: CashflowEntry[];
  readonly totals: {
    readonly scheduledMinor: number;
    readonly paidMinor: number;
    readonly toPayMinor: number;
  };
}

/** 'YYYY-MM' from a stored calendar date; the engine never formats labels. */
export function monthKey(iso: ISODate): string {
  return iso.slice(0, 7);
}

function compareEntries(a: CashflowEntry, b: CashflowEntry): number {
  if (a.dueISO !== b.dueISO) return a.dueISO < b.dueISO ? -1 : 1;
  return a.vendorName.localeCompare(b.vendorName);
}

export function cashflow(plan: Plan, today: ISODate): CashflowReport {
  const paidByInstalment = instalmentPayments(plan.expenses);
  const entries: CashflowEntry[] = [];

  for (const vendor of plan.vendors) {
    for (const instalment of vendor.schedule) {
      const paidMinor = paidByInstalment.get(instalment.id) ?? 0;
      const toPayMinor = Math.max(0, instalment.amountMinor - paidMinor);
      entries.push({
        instalmentId: instalment.id,
        vendorId: vendor.id,
        vendorName: vendor.name,
        kind: instalment.kind,
        dueISO: instalment.dueISO,
        amountMinor: instalment.amountMinor,
        paidMinor,
        toPayMinor,
        overdue: toPayMinor > 0 && instalment.dueISO < today,
      });
    }
  }

  entries.sort(compareEntries);

  const byMonth = new Map<string, CashflowEntry[]>();
  for (const entry of entries) {
    const key = monthKey(entry.dueISO);
    const bucket = byMonth.get(key);
    if (bucket === undefined) byMonth.set(key, [entry]);
    else bucket.push(entry);
  }

  const months: CashflowMonth[] = [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, monthEntries]) => ({
      month,
      entries: monthEntries,
      scheduledMinor: monthEntries.reduce((sum, e) => sum + e.amountMinor, 0),
      toPayMinor: monthEntries.reduce((sum, e) => sum + e.toPayMinor, 0),
    }));

  const overdue = entries.filter((e) => e.overdue);
  return {
    months,
    overdue,
    totals: {
      scheduledMinor: entries.reduce((sum, e) => sum + e.amountMinor, 0),
      paidMinor: entries.reduce((sum, e) => sum + e.paidMinor, 0),
      toPayMinor: entries.reduce((sum, e) => sum + e.toPayMinor, 0),
    },
  };
}
