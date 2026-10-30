import type { ISODate } from './dates';
import type { Minor } from './money';

export type Occasion = 'wedding' | 'birthday' | 'community';
export type Rsvp = 'yes' | 'no' | 'pending';
export type BookingStatus = 'not_started' | 'contacted' | 'quoted' | 'booked' | 'cancelled';
type PaymentKind = 'advance' | 'instalment' | 'balance';
export type DietaryTag =
  'vegetarian' | 'vegan' | 'halal' | 'kosher' | 'gluten_free' | 'nut_allergy' | 'jain';

export interface Category {
  readonly id: string;
  /** Stable machine key ("catering", "contingency"); custom categories use their own key. */
  readonly key: string;
  readonly name: string;
  readonly plannedMinor: Minor;
}

export interface Instalment {
  readonly id: string;
  readonly kind: PaymentKind;
  readonly dueISO: ISODate;
  readonly amountMinor: Minor;
}

export interface Vendor {
  readonly id: string;
  readonly categoryId: string;
  readonly name: string;
  readonly contactNote: string;
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
}
