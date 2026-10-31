/* Engine benchmark. Run: npm run bench. Prints real timings measured on this machine. */
import { budgetTotals } from '../src/engine/budget';
import { createPlan } from '../src/engine/create';
import { buildIcs } from '../src/engine/ics';
import { allocateByWeights } from '../src/engine/money';
import { reducePlan } from '../src/engine/reducer';
import { summarize } from '../src/engine/summary';
import { delayTask } from '../src/engine/tasks';
import { buildTimeline } from '../src/engine/timeline';
import type { Expense, Guest, Plan, Task, Vendor } from '../src/engine/types';

const TODAY = '2026-10-30';
const RUNS = 30;

function basePlan(): Plan {
  const created = createPlan(
    {
      id: 'bench',
      name: 'Bench',
      occasion: 'wedding',
      dateISO: '2027-06-01',
      currency: 'INR',
      locale: 'en-IN',
      budgetMinor: 1_000_000_000,
      guestTarget: 500,
    },
    TODAY,
  );
  if (!created.ok) throw new Error(created.error.message);
  return created.value.plan;
}

function sized(
  tasks: number,
  guests: number,
  expenses: number,
  vendors: number,
  instalments: number,
): Plan {
  const plan = basePlan();
  const venue = plan.categories[0]?.id ?? '';
  const taskList: Task[] = Array.from({ length: tasks }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    dueISO: '2027-01-01',
    dependsOn: i > 0 ? [`t${i - 1}`] : [],
    assignee: null,
    done: false,
  }));
  const guestList: Guest[] = Array.from({ length: guests }, (_, i) => ({
    id: `g${i}`,
    name: `Guest ${i}`,
    rsvp: i % 3 === 0 ? 'pending' : 'yes',
    plusOnes: i % 2,
    dietary: i % 5 === 0 ? ['vegan'] : [],
    group: 'G',
    contact: '',
    note: '',
  }));
  const vendorList: Vendor[] = Array.from({ length: vendors }, (_, v) => ({
    id: `v${v}`,
    categoryId: venue,
    name: `Vendor ${v}`,
    contactNote: '',
    contactPerson: '',
    phone: '',
    email: '',
    status: 'booked',
    committedMinor: 1_000_000,
    schedule: Array.from({ length: instalments }, (_, i) => ({
      id: `i${v}-${i}`,
      kind: 'instalment' as const,
      dueISO: '2027-02-01',
      amountMinor: 1000,
      note: '',
    })),
  }));
  const expenseList: Expense[] = Array.from({ length: expenses }, (_, i) => ({
    id: `x${i}`,
    categoryId: venue,
    vendorId: vendors > 0 ? `v${i % vendors}` : null,
    instalmentId: null,
    dateISO: '2026-11-01',
    amountMinor: 100,
    note: '',
  }));
  return {
    ...plan,
    tasks: taskList,
    guests: guestList,
    expenses: expenseList,
    vendors: vendorList,
  };
}

function median(fn: () => unknown): number {
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(RUNS / 2)] ?? 0;
}

const realistic = sized(60, 150, 40, 8, 3);
const extreme = sized(500, 5000, 5000, 200, 12);
const rows: [string, number, number][] = [];
const add = (name: string, fn: (p: Plan) => unknown): void => {
  rows.push([name, median(() => fn(realistic)), median(() => fn(extreme))]);
};

add('summarize (totals + warnings + headcount)', (p) => summarize(p, TODAY));
add('budgetTotals', (p) => budgetTotals(p));
add('buildTimeline', (p) => buildTimeline(p, TODAY));
add('buildIcs', (p) => buildIcs('Bench', buildTimeline(p, TODAY), TODAY));
add('delay first task (ripples down the chain)', (p) => delayTask(p.tasks, 't0', 3));
add('reducePlan: expense/add (just under the 5,000 cap)', (p) =>
  reducePlan(
    { ...p, expenses: p.expenses.slice(1) },
    {
      type: 'expense/add',
      id: 'new',
      categoryId: p.categories[0]?.id ?? '',
      vendorId: null,
      instalmentId: null,
      dateISO: TODAY,
      amountMinor: 1,
      note: '',
    },
    { today: TODAY },
  ),
);
rows.push([
  'allocateByWeights (7 parts)',
  median(() => allocateByWeights(1_000_000_000_000, [3000, 3000, 1000, 800, 600, 600, 1000])),
  0,
]);

console.log(`Median of ${RUNS} runs, milliseconds. Node ${process.version}.`);
console.log(
  `realistic = 60 tasks, 150 guests, 40 expenses, 8 vendors; extreme = 500 tasks, 5000 guests, 5000 expenses, 200 vendors x 12 instalments\n`,
);
console.log('| operation | realistic ms | extreme ms |\n|---|---:|---:|');
for (const [name, a, b] of rows)
  console.log(`| ${name} | ${a.toFixed(3)} | ${b === 0 ? 'n/a' : b.toFixed(3)} |`);
