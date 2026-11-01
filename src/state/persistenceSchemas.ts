import { z } from 'zod';
import '../schemas/zodRuntime.js';
import { MAX_AMOUNT_MINOR } from '../config/limits';

/**
 * The zod schemas every persisted plan must satisfy before it is trusted. They are the
 * first of the two persistence gates: shape and bounds here, referential integrity and
 * domain invariants in `persistenceInvariants.ts`. Everything loaded from storage is
 * untrusted, so every nested record of every event is validated — not just the top level.
 * Fields added after the first release (`locked`, contact fields, notes) default so that
 * records written before they existed still load.
 */

const minor = z.number().int().min(0).max(MAX_AMOUNT_MINOR);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idField = z.string().min(1).max(100);

const categorySchema = z
  .object({
    id: idField,
    key: z.string().min(1).max(100),
    name: z.string().min(1).max(120),
    plannedMinor: minor,
    // Fields added in Phase 2 default for records written before them existed.
    locked: z.boolean().default(false),
  })
  .strict();

const instalmentSchema = z
  .object({
    id: idField,
    kind: z.enum(['advance', 'instalment', 'milestone', 'final', 'balance', 'custom']),
    dueISO: isoDate,
    amountMinor: minor,
    note: z.string().max(500).default(''),
  })
  .strict();

const vendorSchema = z
  .object({
    id: idField,
    categoryId: idField,
    name: z.string().min(1).max(120),
    contactNote: z.string().max(500),
    contactPerson: z.string().max(120).default(''),
    phone: z.string().max(40).default(''),
    email: z.string().max(120).default(''),
    status: z.enum(['not_started', 'contacted', 'quoted', 'booked', 'cancelled']),
    committedMinor: minor.nullable(),
    schedule: z.array(instalmentSchema).max(12),
  })
  .strict();

const expenseSchema = z
  .object({
    id: idField,
    categoryId: idField,
    vendorId: idField.nullable(),
    instalmentId: idField.nullable(),
    dateISO: isoDate,
    amountMinor: minor,
    note: z.string().max(500),
  })
  .strict();

const taskSchema = z
  .object({
    id: idField,
    title: z.string().min(1).max(120),
    dueISO: isoDate,
    dependsOn: z.array(idField).max(10),
    assignee: z.string().max(80).nullable(),
    done: z.boolean(),
  })
  .strict();

const dietary = z.enum([
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
  'dairy_free',
  'nut_allergy',
  'no_onion_garlic',
  'jain',
  'other',
]);

const guestSchema = z
  .object({
    id: idField,
    name: z.string().min(1).max(120),
    rsvp: z.enum(['yes', 'no', 'pending']),
    plusOnes: z.number().int().min(0).max(10),
    dietary: z.array(dietary).max(10),
    group: z.string().max(80),
    contact: z.string().max(120).default(''),
    note: z.string().max(500).default(''),
  })
  .strict();

const runSheetEntrySchema = z
  .object({
    id: idField,
    title: z.string().min(1).max(120),
    dateISO: isoDate,
    startTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
    ownerId: idField.nullable(),
    location: z.string().max(120),
    note: z.string().max(500),
    done: z.boolean(),
  })
  .strict();

export const deepPlanSchema = z
  .object({
    id: idField,
    name: z.string().min(1).max(120),
    occasion: z.enum(['wedding', 'birthday', 'community', 'milestone']),
    dateISO: isoDate,
    currency: z.string().min(3).max(3),
    locale: z.string().min(2).max(35),
    budgetMinor: minor,
    guestTarget: z.number().int().min(1).max(100_000),
    categories: z.array(categorySchema).max(30),
    vendors: z.array(vendorSchema).max(200),
    expenses: z.array(expenseSchema).max(5_000),
    tasks: z.array(taskSchema).max(500),
    guests: z.array(guestSchema).max(5_000),
    runSheet: z.array(runSheetEntrySchema).max(100).default([]),
  })
  .strict();
