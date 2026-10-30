import type { ISODate } from './dates.js';
import type { BookingStatus, DietaryTag, Instalment, Rsvp } from './types.js';

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
      readonly status: BookingStatus;
      readonly committedMinor: number | null;
    }
  | {
      readonly type: 'vendor/update';
      readonly id: string;
      readonly categoryId?: string;
      readonly name?: string;
      readonly contactNote?: string;
      readonly status?: BookingStatus;
      readonly committedMinor?: number | null;
    }
  | { readonly type: 'vendor/delete'; readonly id: string }
  | {
      readonly type: 'vendor/setSchedule';
      readonly id: string;
      readonly schedule: readonly Instalment[];
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
    }
  | {
      readonly type: 'guest/update';
      readonly id: string;
      readonly name?: string;
      readonly rsvp?: Rsvp;
      readonly plusOnes?: number;
      readonly dietary?: readonly DietaryTag[];
      readonly group?: string;
    }
  | { readonly type: 'guest/delete'; readonly id: string };

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
