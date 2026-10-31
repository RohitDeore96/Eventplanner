import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
import { formatMoney } from '../engine/money';
import { localToday } from './format';

/**
 * Export (R8): real data only, from the engine's own numbers. Downloads happen in the
 * browser; nothing is sent anywhere.
 */

function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40) || 'utsav-plan';

/** Full plan as validated JSON (importable again; import re-validates through the engine). */
export function exportJson(plan: Plan): void {
  const blob = new Blob(
    [JSON.stringify({ schemaVersion: 1, savedAtISO: new Date().toISOString(), plan }, null, 2)],
    {
      type: 'application/json',
    },
  );
  download(`utsav-${slug(plan.name)}.json`, blob);
}

/** Raw text download; used to keep a copy of stored data that failed validation. */
export function exportTextFile(filename: string, contents: string): void {
  download(filename, new Blob([contents], { type: 'application/json' }));
}

/** Budget + expense log as CSV with the real committed/paid figures. */
export function exportCsv(plan: Plan): void {
  const today = localToday();
  const summary = summarize(plan, today);
  const rows: string[][] = [
    ['Section', 'Name', 'Detail', 'Amount minor', 'Currency'],
    ...summary.categories.map((category) => [
      'Category',
      category.name,
      `committed ${category.committed}, paid ${category.paid}, remaining ${category.remaining}`,
      String(category.planned),
      plan.currency,
    ]),
    [
      'Total',
      'All categories',
      `budget ${summary.totals.budget}, remaining ${summary.totals.remaining}`,
      String(summary.totals.planned),
      plan.currency,
    ],
    ...plan.expenses.map((expense) => [
      'Expense',
      expense.note || '(no note)',
      `${expense.dateISO} in ${plan.categories.find((category) => category.id === expense.categoryId)?.name ?? 'unknown'}`,
      String(expense.amountMinor),
      plan.currency,
    ]),
    ...plan.tasks.map((task) => [
      'Task',
      task.title,
      `due ${task.dueISO}${task.done ? ' (done)' : ''}`,
      '',
      '',
    ]),
  ];
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
    .join('\r\n');
  download(
    `utsav-${slug(plan.name)}.csv`,
    new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }),
  );
}

/**
 * Human-readable event summary (Phase 3 §9.4): one text file with the whole plan —
 * budget overview, category figures, vendors and payment status, guest and dietary
 * AGGREGATES (never individual guests or contact details), tasks, run sheet and the
 * engine's warnings. Built entirely from summarize() and the plan, so it always matches
 * what the app shows.
 */
export function buildSummaryText(plan: Plan, today: string): string {
  const summary = summarize(plan, today);
  const money = (minor: number): string => formatMoney(minor, plan.currency, plan.locale);
  const lines: string[] = [
    `UTSAV — EVENT SUMMARY`,
    `=====================`,
    ``,
    `Event: ${plan.name}`,
    `Occasion: ${plan.occasion} · Date: ${plan.dateISO} · Currency: ${plan.currency}`,
    `Guest target: ${plan.guestTarget}`,
    ``,
    `BUDGET OVERVIEW`,
    `---------------`,
    `Budget:      ${money(summary.totals.budget)}`,
    `Planned:     ${money(summary.totals.planned)}`,
    `Committed:   ${money(summary.totals.committed)}`,
    `Paid:        ${money(summary.totals.paid)}`,
    `Remaining budget: ${money(summary.totals.remaining)}`,
    `Still to pay (committed minus paid): ${money(
      Math.max(0, summary.totals.committed - summary.totals.paid),
    )}`,
    ``,
    `CATEGORIES`,
    `----------`,
    ...summary.categories.map(
      (c) =>
        `${c.name}: planned ${money(c.planned)}, committed ${money(c.committed)}, paid ${money(
          c.paid,
        )}, remaining ${money(Math.max(0, c.remaining))}${c.remaining < 0 ? ' (OVER)' : ''}`,
    ),
    ``,
    `VENDORS AND PAYMENTS`,
    `--------------------`,
    ...(plan.vendors.length === 0
      ? ['No vendors recorded yet.']
      : plan.vendors.map((v) => {
          const agreed =
            v.committedMinor === null ? 'not agreed yet' : `agreed ${money(v.committedMinor)}`;
          const schedule =
            v.schedule.length === 0
              ? 'no scheduled instalments'
              : v.schedule
                  .map((inst) => {
                    const paid = plan.expenses
                      .filter((e) => e.instalmentId === inst.id)
                      .reduce((acc, e) => acc + e.amountMinor, 0);
                    const state =
                      paid >= inst.amountMinor
                        ? 'PAID'
                        : paid > 0
                          ? 'partly paid'
                          : inst.dueISO < today
                            ? 'OVERDUE'
                            : 'scheduled';
                    return `${inst.kind} due ${inst.dueISO}: ${money(inst.amountMinor)} (${state})`;
                  })
                  .join('; ');
          return `${v.name} [${v.status}] ${agreed} — ${schedule}`;
        })),
    ``,
    `GUESTS (aggregates only — individual details stay in the app)`,
    `-------------------------------------------------------------`,
    `Confirmed: ${summary.headcount.confirmed} · Pending: ${summary.headcount.pending} · Declined: ${summary.headcount.declined}`,
    `Catering headcount: ${summary.catering.headcount} (${summary.catering.basis})`,
    `Dietary (confirmed guests): ${
      Object.keys(summary.catering.dietary).length === 0
        ? 'none recorded'
        : Object.entries(summary.catering.dietary)
            .map(([tag, count]) => `${tag} ${count}`)
            .join(', ')
    }`,
    ``,
    `TASKS`,
    `-----`,
    `${summary.readiness.tasksDone}/${summary.readiness.tasksTotal} done; ${summary.readiness.overdue} overdue.`,
    ...plan.tasks
      .filter((t) => !t.done)
      .sort((a, b) => a.dueISO.localeCompare(b.dueISO))
      .slice(0, 8)
      .map((t) => `- ${t.title} (due ${t.dueISO})`),
    ``,
    `RUN SHEET`,
    `---------`,
    ...(plan.runSheet.length === 0
      ? ['No event-day schedule yet.']
      : [...plan.runSheet]
          .sort((a, b) => `${a.dateISO}${a.startTime}`.localeCompare(`${b.dateISO}${b.startTime}`))
          .map(
            (entry) =>
              `${entry.dateISO} ${entry.startTime}${entry.endTime ? `-${entry.endTime}` : ''}: ${entry.title}${
                entry.ownerId
                  ? ` (owner: ${plan.vendors.find((v) => v.id === entry.ownerId)?.name ?? 'vendor'})`
                  : ''
              }${entry.location ? ` at ${entry.location}` : ''}`,
          )),
    ``,
    `WARNINGS`,
    `--------`,
    ...(summary.warnings.length === 0
      ? ['None. The plan is consistent.']
      : summary.warnings.map((w) => `[${w.severity.toUpperCase()}] ${w.message}`)),
    ``,
    `Exported ${new Date().toISOString().slice(0, 10)} from Utsav — every figure above is computed from the plan by the same engine the app uses.`,
  ];
  return lines.join('\n');
}

/** Downloads the event summary as a plain-text file. */
export function exportSummary(plan: Plan): void {
  download(
    `utsav-${slug(plan.name)}-summary.txt`,
    new Blob([buildSummaryText(plan, localToday())], { type: 'text/plain;charset=utf-8' }),
  );
}
