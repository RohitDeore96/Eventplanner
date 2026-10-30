import type { DietaryTag, Guest, Plan } from './types';

export interface Headcount {
  readonly confirmed: number;
  readonly pending: number;
  readonly declined: number;
  /** Confirmed plus everyone who has not answered yet: the worst case for catering. */
  readonly ifAllPendingCome: number;
}

function partySize(guest: Guest): number {
  return 1 + guest.plusOnes;
}

export function headcount(guests: readonly Guest[]): Headcount {
  let confirmed = 0;
  let pending = 0;
  let declined = 0;
  for (const guest of guests) {
    if (guest.rsvp === 'yes') confirmed += partySize(guest);
    else if (guest.rsvp === 'pending') pending += partySize(guest);
    else declined += partySize(guest);
  }
  return { confirmed, pending, declined, ifAllPendingCome: confirmed + pending };
}

export type DietaryCounts = Readonly<Partial<Record<DietaryTag, number>>>;

/** Counts confirmed guests per dietary need. Plus-ones are not counted: their needs are unknown. */
export function dietaryCounts(guests: readonly Guest[]): DietaryCounts {
  const counts: Partial<Record<DietaryTag, number>> = {};
  for (const guest of guests) {
    if (guest.rsvp !== 'yes') continue;
    for (const tag of new Set(guest.dietary)) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return counts;
}

export interface CateringRequirement {
  /** Headcount to cater for: confirmed guests once any RSVP exists, otherwise the planned target. */
  readonly headcount: number;
  readonly basis: 'confirmed' | 'target';
  readonly dietary: DietaryCounts;
  /** Catering plan divided by headcount, in minor units (rounded down). Null if headcount is 0. */
  readonly perHeadMinor: number | null;
}

export function cateringRequirement(plan: Plan, cateringPlannedMinor: number): CateringRequirement {
  const counts = headcount(plan.guests);
  const hasRsvps = plan.guests.length > 0 && counts.confirmed > 0;
  const people = hasRsvps ? counts.confirmed : plan.guestTarget;
  return {
    headcount: people,
    basis: hasRsvps ? 'confirmed' : 'target',
    dietary: dietaryCounts(plan.guests),
    perHeadMinor: people > 0 ? Math.floor(cateringPlannedMinor / people) : null,
  };
}
