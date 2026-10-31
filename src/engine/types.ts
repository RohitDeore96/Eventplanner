import type { ISODate } from './dates.js';
import type { Minor } from './money.js';

export type Occasion = 'wedding' | 'birthday' | 'community' | 'milestone';
export type Rsvp = 'yes' | 'no' | 'pending';
export type BookingStatus = 'not_started' | 'contacted' | 'quoted' | 'booked' | 'cancelled';
export type PaymentKind = 'advance' | 'instalment' | 'milestone' | 'final' | 'balance' | 'custom';
export type DietaryTag =
  | 'vegetarian'
  | 'vegan'
  | 'halal'
  | 'kosher'
  | 'gluten_free'
  | 'dairy_free'
  | 'nut_allergy'
  | 'no_onion_garlic'
  | 'jain'
  | 'other';

export interface Category {
  readonly id: string;
  /** Stable machine key ("catering", "contingency"); custom categories use their own key. */
  readonly key: string;
  readonly name: string;
  readonly plannedMinor: Minor;
  /** Locked categories refuse budget moves and planned-amount edits (M6 trade-off safety). */
  readonly locked: boolean;
}

export interface Instalment {
  readonly id: string;
  readonly kind: PaymentKind;
  readonly dueISO: ISODate;
  readonly amountMinor: Minor;
  /** Optional payment reference or note (M5.2). Payment status/date stay DERIVED from expenses. */
  readonly note: string;
}

export interface Vendor {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly contactNote: string;
  /** Optional contact details (M5.1). Empty string when not supplied. */
  readonly contactPerson: string;
  readonly phone: string;
  readonly email: string;
  readonly status: BookingStatus;
  /** Agreed price. Only counts as committed while status is "booked". */
  readonly committedMinor: Minor | null;
  readonly schedule: readonly Instalment[];
}

/** Money actually paid. The single source of truth for "paid". */
export interface Expense {
  readonly id: string;
  readonly categoryId: string;
  readonly vendorId: string | null;
  /** Set when this expense settles a scheduled instalment. */
  readonly instalmentId: string | null;
  readonly dateISO: ISODate;
  readonly amountMinor: Minor;
  readonly note: string;
}

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly dueISO: ISODate;
  readonly dependsOn: readonly string[];
  readonly assignee: string | null;
  readonly done: boolean;
}

export interface Guest {
  readonly id: string;
  readonly name: string;
  readonly rsvp: Rsvp;
  readonly plusOnes: number;
  readonly dietary: readonly DietaryTag[];
  readonly group: string;
  /** Optional contact details and free-text notes (M8.1). Empty string when not supplied. */
  readonly contact: string;
  readonly note: string;
}

/** One event-day activity (M7 run sheet). Times are HH:MM 24-hour, local to the event day. */
export interface RunSheetEntry {
  readonly id: string;
  readonly title: string;
  readonly dateISO: ISODate;
  readonly startTime: string;
  readonly endTime: string;
  /** Vendor responsible, when the activity belongs to one; null for the family itself. */
  readonly ownerId: string | null;
  readonly location: string;
  readonly note: string;
  readonly done: boolean;
}

export interface Plan {
  readonly id: string;
  readonly name: string;
  readonly occasion: Occasion;
  readonly dateISO: ISODate;
  /** ISO 4217 code. Amounts are stored in this currency's minor units. */
  readonly currency: string;
  readonly locale: string;
  readonly budgetMinor: Minor;
  /** Planned headcount before RSVPs arrive. */
  readonly guestTarget: number;
  readonly categories: readonly Category[];
  readonly vendors: readonly Vendor[];
  readonly expenses: readonly Expense[];
  readonly tasks: readonly Task[];
  readonly guests: readonly Guest[];
  /** Event-day schedule (M7); distinct from planning tasks and payment due dates. */
  readonly runSheet: readonly RunSheetEntry[];
}
