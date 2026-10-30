import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
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
