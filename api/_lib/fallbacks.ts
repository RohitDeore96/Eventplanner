import type { Ideas, IntakeParse, PlanReview, QuoteFields } from '../../src/schemas/ai';

/**
 * Deterministic fallbacks: every AI feature degrades to an honest, useful answer built from
 * the plan's own facts — never invented. When these answer, the UI says so plainly.
 */

const UNIT: Record<string, number> = {
  '': 1,
  l: 100_000,
  lac: 100_000,
  lacs: 100_000,
  lakh: 100_000,
  lakhs: 100_000,
  cr: 10_000_000,
  crore: 10_000_000,
  crores: 10_000_000,
  k: 1_000,
  thousand: 1_000,
};

/** Forgiving rupee reader for fallback intake: "8 lakh", "8L", "2 crore", "450000". */
function parseRupees(text: string): number | null {
  // Numbers with an explicit unit first ("8 lakh"), so "200 guests" is not read as ₹200.
  const withUnit = /(\d+(?:\.\d+)?)\s*(l|lac|lacs|lakh|lakhs|cr|crore|crores|k|thousand)\b/i.exec(
    text,
  );
  if (withUnit !== null) {
    const value = Number(withUnit[1]) * (UNIT[(withUnit[2] ?? '').toLowerCase()] ?? 1);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  const plain = /\b(\d{4,})\b/.exec(text);
  if (plain !== null) {
    const value = Number(plain[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

function guessDate(text: string): string | null {
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso !== null) return iso[1] ?? null;
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const lowered = text.toLowerCase();
  for (const [index, month] of monthNames.entries()) {
    if (lowered.includes(month)) {
      const dayMatch = /\b(\d{1,2})\b/.exec(lowered.slice(lowered.indexOf(month)));
      const day = dayMatch !== null ? Number(dayMatch[1]) : 1;
      if (day >= 1 && day <= 31) {
        const year =
          day >= 1 && new Date().getMonth() > index
            ? new Date().getFullYear() + 1
            : new Date().getFullYear();
        return `${year}-${String(index + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    }
  }
  return null;
}

function guessGuests(text: string): number | null {
  const match = /(\d{1,5})\s*(guests|people|log|invitees)/i.exec(text);
  return match === null ? null : Number(match[1]);
}

function guessOccasion(text: string): IntakeParse['occasion'] {
  const lowered = text.toLowerCase();
  if (/(wedding|shaadi|shadi|vivah|marriage)/.test(lowered)) return 'wedding';
  if (/(birthday|bday|birthday party|happy birthday)/.test(lowered)) return 'birthday';
  if (/(community|ganesh|durga puja|navratri|society|festival|utsav committee)/.test(lowered))
    return 'community';
  return null;
}

function guessName(text: string): string | null {
  const match = /(?:for|called|named)\s+([A-Za-z][A-Za-z\s]{2,40})/i.exec(text);
  return match === null ? null : (match[1]?.trim().slice(0, 80) ?? null);
}

/** Regex intake: honest nulls for anything it cannot see; the form stays the source of truth. */
export function fallbackIntake(text: string): IntakeParse {
  return {
    name: guessName(text),
    occasion: guessOccasion(text),
    dateISO: guessDate(text),
    guests: guessGuests(text),
    budgetMinor: parseRupees(text),
    notes: null,
  };
}

const FALLBACK_IDEAS: Record<'wedding' | 'birthday' | 'community', Ideas> = {
  wedding: {
    themes: ['Marigold and ivory', 'Classic temple courtyard', 'Pastel evening'],
    activities: ['Sangeet night with family performances', 'Mehndi afternoon', 'Haldi at home'],
    foodStyle: ['Live chaat counter', 'Traditional thali', 'North Indian + regional dessert'],
    personalTouches: ['Photo wall of the couple', 'Handwritten place cards', 'Family playlist'],
  },
  birthday: {
    themes: ['Favourite colour rainbow', 'Cricket ground', 'Space adventure'],
    activities: ['Games corner with prizes', 'Cake cutting with a song', 'Photo booth with props'],
    foodStyle: ['Kid-friendly snacks', 'Cupcakes instead of a tall cake', 'Fruit and juice bar'],
    personalTouches: ['Memory jar from guests', 'Growth-chart poster', 'Return gifts made at home'],
  },
  community: {
    themes: ['Lantern courtyard', 'Rangoli entrance', 'Regional heritage'],
    activities: [
      'Cultural programme by residents',
      'Kids quiz on the festival',
      'Community aarti or assembly',
    ],
    foodStyle: ['Prasad-style distribution', 'Potluck by lane', 'Simple satvik menu'],
    personalTouches: [
      'Volunteer badges',
      'Notice-board history wall',
      'Thank-you board for sponsors',
    ],
  },
};

/** Occasion-tuned starting points; the UI labels them as generic when the fallback answers. */
export function fallbackIdeas(occasion: 'wedding' | 'birthday' | 'community'): Ideas {
  return FALLBACK_IDEAS[occasion];
}

export function fallbackReview(facts: string): PlanReview {
  const lines = facts
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const overBudget = facts.includes('over budget');
  const overdueCount = /(\d+) overdue/.exec(facts)?.[1] ?? null;
  const nextSteps: string[] = [];
  if (overBudget) nextSteps.push('Open Budget and pick one over-budget option to apply.');
  if (overdueCount !== null) {
    nextSteps.push(
      `Open Timeline and clear the ${overdueCount} overdue task(s), starting with the earliest.`,
    );
  }
  if (nextSteps.length < 3)
    nextSteps.push('Collect and paste vendor quotes in Vendors to replace estimates.');
  return {
    summary:
      lines.length > 0
        ? 'Here is where your plan stands, from its own numbers: review the flagged items and work top-down.'
        : 'Your plan has nothing flagged right now. Keep collecting quotes and confirming bookings.',
    nextSteps: nextSteps.slice(0, 3),
  };
}

export function fallbackAnswer(question: string, facts: string): string {
  const lowered = question.toLowerCase();
  if (/(budget|kharcha|paisa|money|spent|remaining)/.test(lowered)) {
    const match = /Remaining budget[^.]*\./.exec(facts) ?? /Budget[^.]*\./.exec(facts);
    return match !== null
      ? `${match[0]} Everything here comes from your plan's own numbers.`
      : 'Open the Budget tab — the totals there are computed from your plan directly.';
  }
  if (/(first|next|start|book|priority)/.test(lowered)) {
    return 'Start with what has the longest lead time: venue and caterer. The Timeline tab orders your tasks with dependencies already applied.';
  }
  if (/(guest|rsvp|headcount)/.test(lowered)) {
    return 'The Guests tab tracks RSVPs; catering follows the confirmed count automatically.';
  }
  return `I answer from your plan's own facts while AI is offline. Here is what the plan shows:\n${facts.slice(0, 400)}`;
}

/** Quote extraction has no safe deterministic reader: unknown fields stay null, honestly. */
export function fallbackQuote(): QuoteFields {
  return {
    vendorName: null,
    category: null,
    totalPriceMinor: null,
    pricePerPlateMinor: null,
    guestMinimum: null,
    overtimeFeePerHourMinor: null,
    taxIncluded: null,
    advancePercent: null,
    cancellationPolicy: null,
    inclusions: [],
    exclusions: [],
  };
}
