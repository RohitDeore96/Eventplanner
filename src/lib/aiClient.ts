import { z } from 'zod';
import type {
  IntakeParse,
  Ideas,
  PatchProposal,
  PlanReview,
  PlannerAnswer,
  QuoteFields,
} from '../schemas/ai';
import {
  errorBodySchema,
  ideasSchema,
  intakeParseSchema,
  patchProposalSchema,
  planReviewSchema,
  plannerAnswerSchema,
  quoteFieldsSchema,
} from '../schemas/ai';

/**
 * Typed client for the /api endpoints. Same-origin only, cancel-per-endpoint, and every
 * reply is validated against the same zod schema the server used before it reaches the UI.
 */

export interface AiReply<T> {
  readonly body: T;
  /** 'cache' | model name | 'built-in' — shown to the family so answers are honest. */
  readonly source: string;
}

/**
 * Client patience for one AI answer. The route itself waits up to 40 s (AI_TIMEOUT_MS in
 * api/_lib/http.ts) so a free-tier model chain can fail over; this client must outwait the
 * route, or it aborts a request the server is about to answer — the recorded deployed
 * evidence (docs/evidence/deployed-run-summary.txt) contains a live extract-quote
 * round-trip that took 41 s. 45 s keeps a margin above the route's own typed 504, so the
 * server's verdict — a model answer, the built-in fallback, or 504 AI_TIMEOUT — always
 * wins the race.
 */
export const CLIENT_TIMEOUT_MS = 45_000;

/**
 * One cancellation slot per endpoint. The Assistant view runs review, ask and ideas side
 * by side (independent busy states), so panels are concurrent by design: a new call must
 * only supersede an older call to the SAME endpoint, never another panel's in-flight
 * request (which used to surface as a false "service unavailable" notice).
 */
const inFlight = new Map<string, AbortController>();

async function post<T extends { source: string }>(
  path: string,
  payload: unknown,
  replySchema: z.ZodType<T>,
): Promise<AiReply<T>> {
  inFlight.get(path)?.abort();
  const controller = new AbortController();
  inFlight.set(path, controller);
  const timer = setTimeout(() => {
    controller.abort();
  }, CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const raw: unknown = await response.json();
    if (!response.ok) {
      const message = errorBodySchema.safeParse(raw).success
        ? (raw as { error: string }).error
        : `REQUEST_FAILED_${response.status}`;
      throw new Error(message);
    }
    // Same contract as the server: the reply is schema-validated before the UI sees it
    // (src/schemas/ai.ts — "used by ... the client (response validation)"). Every 200 from
    // Utsav's own routes carries `source` (model name, 'cache' or 'built-in'); anything
    // else becomes a typed error, and the caller's honest offline notice answers instead.
    const parsed = replySchema.safeParse(raw);
    if (!parsed.success) throw new Error('AI_REPLY_INVALID');
    return { body: parsed.data, source: parsed.data.source };
  } finally {
    clearTimeout(timer);
    if (inFlight.get(path) === controller) inFlight.delete(path);
  }
}

/** Every 200 reply from Utsav's routes carries `source`; the client requires it, so a
 * body without one is not mistaken for a Utsav answer. */
const sourceField = z.string();

const intakeReplySchema = intakeParseSchema.extend({ source: sourceField });
const ideasReplySchema = ideasSchema.extend({ source: sourceField });
const reviewReplySchema = planReviewSchema.extend({ source: sourceField });
const askReplySchema = plannerAnswerSchema.extend({ source: sourceField });
const quoteReplySchema = quoteFieldsSchema.extend({ source: sourceField });
const patchReplySchema = patchProposalSchema.extend({ source: sourceField });

/** Saved-preference context the ideas route understands; absent keys are simply omitted. */
export interface IdeasContext {
  readonly budgetMinor?: number;
  readonly notes?: string;
  readonly formality?: 'relaxed' | 'traditional' | 'formal';
  readonly budgetTier?: 'value' | 'balanced' | 'premium';
  readonly mustHaves?: string;
  readonly remainingBudgetMinor?: number;
  readonly bookedVendors?: number;
}

function ideasPayload(context?: IdeasContext): Record<string, unknown> {
  if (context === undefined) return {};
  const given: Record<string, unknown> = {};
  if (context.budgetMinor !== undefined) given.budgetMinor = context.budgetMinor;
  if (context.notes !== undefined && context.notes.length > 0) given.notes = context.notes;
  if (context.formality !== undefined) given.formality = context.formality;
  if (context.budgetTier !== undefined) given.budgetTier = context.budgetTier;
  if (context.mustHaves !== undefined && context.mustHaves.length > 0) {
    given.mustHaves = context.mustHaves;
  }
  if (context.remainingBudgetMinor !== undefined) {
    given.remainingBudgetMinor = context.remainingBudgetMinor;
  }
  if (context.bookedVendors !== undefined) given.bookedVendors = context.bookedVendors;
  return given;
}

export const aiClient = {
  parseIntake: (
    text: string,
    currency: string,
  ): Promise<AiReply<IntakeParse & { source: string }>> =>
    post('/api/parse-intake', { text, currency }, intakeReplySchema),
  ideas: (
    occasion: string,
    vibe: string,
    guests: number,
    context?: IdeasContext,
  ): Promise<AiReply<Ideas & { source: string }>> =>
    post(
      '/api/suggest-ideas',
      {
        occasion,
        vibe,
        guests,
        ...ideasPayload(context),
      },
      ideasReplySchema,
    ),
  review: (facts: string): Promise<AiReply<PlanReview & { source: string }>> =>
    post('/api/review-plan', { facts }, reviewReplySchema),
  ask: (question: string, facts: string): Promise<AiReply<PlannerAnswer & { source: string }>> =>
    post('/api/ask-planner', { question, facts }, askReplySchema),
  extractQuote: (
    text: string,
    currency: string,
  ): Promise<AiReply<QuoteFields & { source: string }>> =>
    post('/api/extract-quote', { text, currency }, quoteReplySchema),
  proposePatch: (
    instruction: string,
    facts: string,
    today: string,
    currency: string,
  ): Promise<AiReply<PatchProposal & { source: string }>> =>
    post('/api/propose-patch', { instruction, facts, today, currency }, patchReplySchema),
};
