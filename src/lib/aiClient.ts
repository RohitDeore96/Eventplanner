import type {
  IntakeParse,
  Ideas,
  PatchProposal,
  PlanReview,
  PlannerAnswer,
  QuoteFields,
} from '../schemas/ai';
import { errorBodySchema } from '../schemas/ai';

/**
 * Typed client for the /api endpoints. Same-origin only, 15 s timeout, cancel-on-stale:
 * a newer call aborts the older one's fetch automatically.
 */

export interface AiReply<T> {
  readonly body: T;
  /** 'cache' | model name | 'built-in' — shown to the family so answers are honest. */
  readonly source: string;
}

let current: AbortController | null = null;

async function post<T extends { source?: string }>(
  path: string,
  payload: unknown,
): Promise<AiReply<T>> {
  current?.abort();
  const controller = new AbortController();
  current = controller;
  const timer = setTimeout(() => {
    controller.abort();
  }, 16_000);
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
    const body = raw as T;
    return { body, source: body.source ?? 'unknown' };
  } finally {
    clearTimeout(timer);
  }
}

export const aiClient = {
  parseIntake: (
    text: string,
    currency: string,
  ): Promise<AiReply<IntakeParse & { source: string }>> =>
    post('/api/parse-intake', { text, currency }),
  ideas: (
    occasion: string,
    vibe: string,
    guests: number,
    context?: { readonly budgetMinor?: number; readonly notes?: string },
  ): Promise<AiReply<Ideas & { source: string }>> =>
    post('/api/suggest-ideas', {
      occasion,
      vibe,
      guests,
      ...(context?.budgetMinor !== undefined ? { budgetMinor: context.budgetMinor } : {}),
      ...(context?.notes !== undefined && context.notes.length > 0 ? { notes: context.notes } : {}),
    }),
  review: (facts: string): Promise<AiReply<PlanReview & { source: string }>> =>
    post('/api/review-plan', { facts }),
  ask: (question: string, facts: string): Promise<AiReply<PlannerAnswer & { source: string }>> =>
    post('/api/ask-planner', { question, facts }),
  extractQuote: (text: string): Promise<AiReply<QuoteFields & { source: string }>> =>
    post('/api/extract-quote', { text }),
  proposePatch: (
    instruction: string,
    facts: string,
    today: string,
  ): Promise<AiReply<PatchProposal & { source: string }>> =>
    post('/api/propose-patch', { instruction, facts, today }),
};
