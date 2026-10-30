import type { PlanAction } from '../engine/actions';
import { createPlan } from '../engine/create';
import { reducePlan } from '../engine/reducer';
import type { Plan } from '../engine/types';

const DEMO_TODAY = '2026-10-30';

/**
 * The demo event (X3): a wedding plan with vendors, payments, expenses, guests and a
 * delayed task, built entirely through the engine so a judge sees every feature in
 * 30 seconds. Deterministic: same actions, same plan.
 */
export function buildDemoPlan(today: string = DEMO_TODAY): Plan | null {
  const created = createPlan(
    {
      id: 'demo-shaadi',
      name: 'Asha & Dev wedding',
      occasion: 'wedding',
      dateISO: '2027-02-14',
      currency: 'INR',
      locale: 'en-IN',
      budgetMinor: 80_000_000,
      guestTarget: 150,
    },
    today,
  );
  if (!created.ok) return null;
  let plan = created.value.plan;

  const cat = (key: string): string => plan.categories.find((c) => c.key === key)?.id ?? 'none';

  const actions: PlanAction[] = [
    {
      type: 'vendor/add',
      id: 'v-venue',
      categoryId: cat('venue'),
      name: 'Sunny Lawns',
      contactNote: 'Call after 6 pm; ask for the February rate',
      status: 'booked',
      committedMinor: 21_000_000,
    },
    {
      type: 'vendor/setSchedule',
      id: 'v-venue',
      schedule: [
        { id: 'i-venue-adv', kind: 'advance', dueISO: '2026-10-15', amountMinor: 8_000_000 },
        { id: 'i-venue-bal', kind: 'balance', dueISO: '2027-01-20', amountMinor: 13_000_000 },
      ],
    },
    {
      type: 'expense/add',
      id: 'x-venue-adv',
      categoryId: cat('venue'),
      vendorId: 'v-venue',
      instalmentId: 'i-venue-adv',
      dateISO: '2026-10-14',
      amountMinor: 4_000_000,
      note: 'Advance paid in cash',
    },
    {
      type: 'vendor/add',
      id: 'v-caterer',
      categoryId: cat('catering'),
      name: 'Annapurna Caterers',
      contactNote: 'Quoted 1250 per plate for 150 guests',
      status: 'quoted',
      committedMinor: null,
    },
    {
      type: 'vendor/add',
      id: 'v-photo',
      categoryId: cat('photography'),
      name: 'Pixel Stories',
      contactNote: '',
      status: 'contacted',
      committedMinor: null,
    },
    {
      type: 'expense/add',
      id: 'x-decor',
      categoryId: cat('decor'),
      vendorId: null,
      instalmentId: null,
      dateISO: '2026-10-20',
      amountMinor: 1_500_000,
      note: 'Decor deposit',
    },
    {
      type: 'guest/add',
      id: 'g-meera',
      name: "Meera (bride's mother)",
      rsvp: 'yes',
      plusOnes: 1,
      dietary: ['vegetarian'],
      group: 'Family',
    },
    {
      type: 'guest/add',
      id: 'g-rohan',
      name: 'Rohan & Kavya',
      rsvp: 'pending',
      plusOnes: 0,
      dietary: [],
      group: 'Friends',
    },
    {
      type: 'guest/add',
      id: 'g-uncle',
      name: 'Uncle Prakash',
      rsvp: 'no',
      plusOnes: 0,
      dietary: ['jain'],
      group: 'Family',
    },
    {
      type: 'task/delay',
      id: plan.tasks[0]?.id ?? 'none',
      days: 12,
    },
  ];

  for (const action of actions) {
    const next = reducePlan(plan, action, { today });
    if (!next.ok) return null; // demo must always build; a failure is a bug worth surfacing
    plan = next.value;
  }
  return plan;
}
