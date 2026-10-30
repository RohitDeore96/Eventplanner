import { z } from 'zod';
import './zodRuntime.js';

/**
 * Shared AI contract schemas — used by the serverless functions (input and AI output
 * validation), by the client (response validation) and by the tests. One source of truth.
 * The AI never sends money: every amount here is either null or a non-negative integer of
 * minor units that the ENGINE will re-check against the plan before anything is applied.
 */

const INTAKE_MAX_CHARS = 1000;
const QUOTE_MAX_CHARS = 6000;
const QUESTION_MAX_CHARS = 500;
const INSTRUCTION_MAX_CHARS = 400;

const intakeParseSchema = z.object({
  name: z.string().max(80).nullable(),
  occasion: z.enum(['wedding', 'birthday', 'community']).nullable(),
  dateISO: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  guests: z.number().int().min(1).max(100_000).nullable(),
  budgetMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  notes: z.string().max(500).nullable(),
});
export type IntakeParse = z.infer<typeof intakeParseSchema>;

/**
 * What the MODEL fills: amounts in MAJOR units, exactly as the human wrote them ("8 lakh"
 * -> 800000). Converting major -> minor is the server's job, done exactly once with the
 * request currency — models must never be trusted to know minor-unit exponents.
 */
export const aiIntakeParseSchema = intakeParseSchema.omit({ budgetMinor: true }).extend({
  budgetMajor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
});

/** The six currencies the app supports, shared by requests. */
const currencyCodeSchema = z.enum(['INR', 'USD', 'EUR', 'GBP', 'AED', 'JPY']);

export const ideasSchema = z.object({
  themes: z.array(z.string().min(1).max(120)).max(6),
  activities: z.array(z.string().min(1).max(120)).max(6),
  foodStyle: z.array(z.string().min(1).max(120)).max(6),
  personalTouches: z.array(z.string().min(1).max(120)).max(6),
});
export type Ideas = z.infer<typeof ideasSchema>;

export const planReviewSchema = z.object({
  summary: z.string().min(1).max(600),
  nextSteps: z.array(z.string().min(1).max(200)).max(3),
});
export type PlanReview = z.infer<typeof planReviewSchema>;

export const plannerAnswerSchema = z.object({
  answer: z.string().min(1).max(1200),
});
export type PlannerAnswer = z.infer<typeof plannerAnswerSchema>;

export const quoteFieldsSchema = z.object({
  vendorName: z.string().max(80).nullable(),
  category: z.string().max(40).nullable(),
  totalPriceMinor: z.number().int().min(0).max(1_000_000_000_000).nullable(),
  pricePerPlateMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  guestMinimum: z.number().int().min(0).max(100_000).nullable(),
  overtimeFeePerHourMinor: z.number().int().min(0).max(1_000_000_000).nullable(),
  taxIncluded: z.boolean().nullable(),
  advancePercent: z.number().int().min(0).max(100).nullable(),
  cancellationPolicy: z.string().max(300).nullable(),
  inclusions: z.array(z.string().max(80)).max(10),
  exclusions: z.array(z.string().max(80)).max(10),
});
export type QuoteFields = z.infer<typeof quoteFieldsSchema>;

/** An AI patch proposal: the same action shapes the engine's dry-run already understands. */
export const patchProposalSchema = z.object({
  summary: z.string().min(1).max(300),
  actions: z
    .array(
      z.union([
        z.object({
          type: z.literal('task/add'),
          id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
          title: z.string().min(1).max(80),
          dueISO: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          dependsOn: z.array(z.string().max(100)).max(10),
          assignee: z.string().max(80).nullable(),
        }),
        z.object({
          type: z.literal('task/update'),
          id: z.string().max(100),
          title: z.string().min(1).max(80).optional(),
          dueISO: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          assignee: z.string().max(80).nullable().optional(),
          done: z.boolean().optional(),
        }),
        z.object({
          type: z.literal('task/delay'),
          id: z.string().max(100),
          days: z.number().int().min(0).max(365),
        }),
        z.object({
          type: z.literal('budget/move'),
          fromId: z.string().max(100),
          toId: z.string().max(100),
          amountMinor: z.number().int().min(1).max(1_000_000_000_000),
        }),
        z.object({
          type: z.literal('category/add'),
          id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
          name: z.string().min(1).max(80),
          plannedMinor: z.number().int().min(1).max(1_000_000_000_000),
        }),
      ]),
    )
    .min(1)
    .max(10),
});
export type PatchProposal = z.infer<typeof patchProposalSchema>;

/** Request bodies, one per endpoint. Text fields are capped; everything is re-validated server-side. */
export const parseIntakeRequest = z.object({
  text: z.string().min(1).max(INTAKE_MAX_CHARS),
  /** The plan's currency, so amounts are read in the right minor units. Defaults to INR. */
  currency: currencyCodeSchema.default('INR'),
});
export const ideasRequest = z.object({
  occasion: z.enum(['wedding', 'birthday', 'community']),
  /** The family's own words: style, cultural or theme preferences. Empty means unspecified. */
  vibe: z.string().max(200),
  guests: z.number().int().min(1).max(100_000),
  /** Optional context the plan already knows; used for tuning, never quoted as money. */
  budgetMinor: z.number().int().min(0).max(1_000_000_000_000).optional(),
  /** Optional free-text priorities: place, traditions, must-haves. Data, never instructions. */
  notes: z.string().max(300).optional(),
});
export const reviewRequest = z.object({
  facts: z.string().min(1).max(2000),
  question: z.string().max(QUESTION_MAX_CHARS).optional(),
});
export const askRequest = z.object({
  question: z.string().min(1).max(QUESTION_MAX_CHARS),
  facts: z.string().min(1).max(2000),
});
export const quoteRequest = z.object({ text: z.string().min(1).max(QUOTE_MAX_CHARS) });
export const patchRequest = z.object({
  instruction: z.string().min(1).max(INSTRUCTION_MAX_CHARS),
  facts: z.string().min(1).max(2000),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** The standardized JSON error body every endpoint returns. */
export const errorBodySchema = z.object({ error: z.string().min(1) });
