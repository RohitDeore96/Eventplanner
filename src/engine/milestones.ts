import { formatISODate, type ISODate, parseISODate } from './dates.js';
import { fail, ok, type Result } from './result.js';
import type { Occasion, Task } from './types.js';

interface Template {
  readonly key: string;
  readonly title: string;
  /** Days before the event this would ideally be done. */
  readonly offsetDays: number;
  readonly after?: string;
}

const COMMON_TAIL: readonly Template[] = [
  {
    key: 'confirm-vendors',
    title: 'Confirm all vendors and arrival times',
    offsetDays: 7,
    after: 'book-main',
  },
  {
    key: 'final-headcount',
    title: 'Lock the final headcount with caterer',
    offsetDays: 5,
    after: 'send-invites',
  },
  {
    key: 'final-payments',
    title: 'Settle remaining vendor balances',
    offsetDays: 2,
    after: 'confirm-vendors',
  },
  { key: 'event-day', title: 'Event day run-through', offsetDays: 0, after: 'final-payments' },
];

const TEMPLATES: Readonly<Record<Occasion, readonly Template[]>> = {
  wedding: [
    { key: 'set-budget', title: 'Agree the budget and priorities', offsetDays: 180 },
    { key: 'book-main', title: 'Book the venue', offsetDays: 150, after: 'set-budget' },
    { key: 'book-photo', title: 'Book photographer', offsetDays: 120, after: 'book-main' },
    { key: 'send-invites', title: 'Send invitations', offsetDays: 60, after: 'book-main' },
    ...COMMON_TAIL,
  ],
  birthday: [
    { key: 'set-budget', title: 'Agree the budget and theme', offsetDays: 45 },
    {
      key: 'book-main',
      title: 'Book the venue or set up the space',
      offsetDays: 35,
      after: 'set-budget',
    },
    { key: 'send-invites', title: 'Send invitations', offsetDays: 21, after: 'book-main' },
    ...COMMON_TAIL,
  ],
  community: [
    { key: 'set-budget', title: 'Agree scope, budget and volunteers', offsetDays: 60 },
    {
      key: 'book-main',
      title: 'Secure the venue and permissions',
      offsetDays: 45,
      after: 'set-budget',
    },
    { key: 'send-invites', title: 'Announce the event', offsetDays: 28, after: 'book-main' },
    ...COMMON_TAIL,
  ],
  milestone: [
    {
      key: 'set-budget',
      title: 'Agree the budget and the guest of honour\u2019s wishes',
      offsetDays: 90,
    },
    {
      key: 'book-main',
      title: 'Book the venue and the photographer',
      offsetDays: 75,
      after: 'set-budget',
    },
    {
      key: 'memory-lane',
      title: 'Collect photos and messages for the memory lane',
      offsetDays: 40,
      after: 'book-main',
    },
    {
      key: 'send-invites',
      title: 'Send invitations and collect RSVPs',
      offsetDays: 35,
      after: 'book-main',
    },
    ...COMMON_TAIL,
  ],
};

/** Crowd-size milestone, added once the headcount is large enough to need it. */
export const LARGE_EVENT_GUESTS = 150;
const LARGE_EVENT_TASK: Template = {
  key: 'crowd-plan',
  title: 'Plan seating, entry flow and accessibility',
  offsetDays: 14,
  after: 'book-main',
};

export interface MilestoneInput {
  readonly occasion: Occasion;
  readonly dateISO: ISODate;
  readonly guests: number;
  readonly today: ISODate;
  /** Prefix that makes task ids unique within a plan. */
  readonly idPrefix: string;
}

export interface MilestoneResult {
  readonly tasks: Task[];
  readonly compressed: boolean;
  readonly notes: string[];
}

/**
 * Builds preparation tasks working back from the event date. If the ideal schedule would put
 * anything before `today`, the whole schedule is squeezed proportionally into [today, event]:
 * order is preserved and nothing is overdue. A same-day event puts everything on today.
 */
export function generateMilestones(input: MilestoneInput): Result<MilestoneResult> {
  const startDay = parseISODate(input.today);
  const eventDay = parseISODate(input.dateISO);
  if (startDay === null || eventDay === null) {
    return fail('INVALID_DATE', 'Enter a real date as YYYY-MM-DD.', 'dateISO');
  }
  const window = eventDay - startDay;
  if (window < 0)
    return fail(
      'DATE_IN_PAST',
      'The event date has already passed. Choose a future date.',
      'dateISO',
    );

  const base = TEMPLATES[input.occasion];
  const templates = (
    input.guests >= LARGE_EVENT_GUESTS ? [...base, LARGE_EVENT_TASK] : [...base]
  ).sort((a, b) => b.offsetDays - a.offsetDays);
  const longest = Math.max(...templates.map((t) => t.offsetDays));
  const needsCompression = longest > window;

  const tasks: Task[] = [];
  for (const template of templates) {
    const scaled = needsCompression
      ? Math.round(((longest - template.offsetDays) / longest) * window)
      : window - template.offsetDays;
    const dueISO = formatISODate(startDay + scaled);
    tasks.push({
      id: `${input.idPrefix}-${template.key}`,
      title: template.title,
      dueISO,
      dependsOn: template.after === undefined ? [] : [`${input.idPrefix}-${template.after}`],
      assignee: null,
      done: false,
    });
  }

  const notes: string[] = [];
  if (needsCompression) {
    notes.push(
      window === 0
        ? 'The event is today, so every step is due today.'
        : `Only ${window} day(s) remain, so ${tasks.length} steps were squeezed into that window in the same order.`,
    );
  }
  return ok({ tasks, compressed: needsCompression, notes });
}
