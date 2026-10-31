import type { ISODate } from './dates.js';
import type { BookingStatus, DietaryTag, PaymentKind, Rsvp } from './types.js';

/**
 * A scheduled payment as callers may type it: the optional note is normalized to a full
 * Instalment (empty string) by the reducer, so no caller has to invent one.
 */
export interface InstalmentInput {
  readonly id: string;
  readonly kind: PaymentKind;
  readonly dueISO: ISODate;
  readonly amountMinor: number;
  readonly note?: string;
}

/** Every change to a plan, manual or AI-proposed, is one of these and goes through `reducePlan`. */
export type PlanAction =
  | { readonly type: 'event/update'; readonly changes: EventChanges }
  | {
      readonly type: 'category/add';
      readonly id: string;
      readonly name: string;
      readonly plannedMinor: number;
    }
  | {
      readonly type: 'category/update';
      readonly id: string;
      readonly name?: string;
      readonly plannedMinor?: number;
      readonly locked?: boolean;
    }
  | { readonly type: 'category/delete'; readonly id: string }
  | {
      readonly type: 'budget/move';
      readonly fromId: string;
      readonly toId: string;
      readonly amountMinor: number;
    }
  | {
      readonly type: 'task/add';
      readonly id: string;
      readonly title: string;
      readonly dueISO: ISODate;
      readonly dependsOn: readonly string[];
      readonly assignee: string | null;
    }
  | {
      readonly type: 'task/update';
      readonly id: string;
      readonly title?: string;
      readonly dueISO?: ISODate;
      readonly assignee?: string | null;
      readonly done?: boolean;
    }
  | { readonly type: 'task/delete'; readonly id: string }
  | {
      readonly type: 'task/setDependencies';
      readonly id: string;
      readonly dependsOn: readonly string[];
    }
  | { readonly type: 'task/reorder'; readonly id: string; readonly toIndex: number }
  | { readonly type: 'task/delay'; readonly id: string; readonly days: number }
  | {
      readonly type: 'vendor/add';
      readonly id: string;
      readonly categoryId: string;
      readonly name: string;
      readonly contactNote: string;
      readonly contactPerson?: string;
      readonly phone?: string;
      readonly email?: string;
      readonly status: BookingStatus;
      readonly committedMinor: number | null;
    }
  | {
      readonly type: 'vendor/update';
      readonly id: string;
      readonly categoryId?: string;
      readonly name?: string;
      readonly contactNote?: string;
      readonly contactPerson?: string;
      readonly phone?: string;
      readonly email?: string;
      readonly status?: BookingStatus;
      readonly committedMinor?: number | null;
    }
  | { readonly type: 'vendor/delete'; readonly id: string }
  | {
      readonly type: 'vendor/setSchedule';
      readonly id: string;
      /** Notes are optional on input; the reducer normalizes every entry to a full Instalment. */
      readonly schedule: readonly InstalmentInput[];
    }
  | {
      readonly type: 'expense/add';
      readonly id: string;
      readonly categoryId: string;
      readonly vendorId: string | null;
      readonly instalmentId: string | null;
      readonly dateISO: ISODate;
      readonly amountMinor: number;
      readonly note: string;
    }
  | {
      readonly type: 'expense/update';
      readonly id: string;
      readonly dateISO?: ISODate;
      readonly amountMinor?: number;
      readonly note?: string;
      /** Re-linking (M6.2): must pass the same vendor/instalment checks as creation. */
      readonly vendorId?: string | null;
      readonly instalmentId?: string | null;
    }
  | { readonly type: 'expense/delete'; readonly id: string }
  | {
      readonly type: 'guest/add';
      readonly id: string;
      readonly name: string;
      readonly rsvp: Rsvp;
      readonly plusOnes: number;
      readonly dietary: readonly DietaryTag[];
      readonly group: string;
      readonly contact?: string;
      readonly note?: string;
    }
  | {
      readonly type: 'guest/update';
      readonly id: string;
      readonly name?: string;
      readonly rsvp?: Rsvp;
      readonly plusOnes?: number;
      readonly dietary?: readonly DietaryTag[];
      readonly group?: string;
      readonly contact?: string;
      readonly note?: string;
    }
  | { readonly type: 'guest/delete'; readonly id: string }
  | {
      readonly type: 'runsheet/add';
      readonly id: string;
      readonly title: string;
      readonly dateISO: ISODate;
      readonly startTime: string;
      readonly endTime: string;
      readonly ownerId: string | null;
      readonly location: string;
      readonly note: string;
    }
  | {
      readonly type: 'runsheet/update';
      readonly id: string;
      readonly title?: string;
      readonly dateISO?: ISODate;
      readonly startTime?: string;
      readonly endTime?: string;
      readonly ownerId?: string | null;
      readonly location?: string;
      readonly note?: string;
    }
  | { readonly type: 'runsheet/delete'; readonly id: string }
  | { readonly type: 'runsheet/reorder'; readonly id: string; readonly toIndex: number }
  | { readonly type: 'runsheet/toggle'; readonly id: string; readonly done: boolean };

export interface EventChanges {
  readonly name?: string;
  readonly dateISO?: ISODate;
  readonly guestTarget?: number;
  readonly budgetMinor?: number;
  readonly currency?: string;
  readonly locale?: string;
}

export interface ReduceContext {
  readonly today: ISODate;
}
