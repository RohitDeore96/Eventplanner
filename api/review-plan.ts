import { createHandler } from './_lib/http';
import { generateJson } from './_lib/gemini';
import { wrapUserText } from './_lib/prompts';
import { fallbackReview } from './_lib/fallbacks';
import { planReviewSchema, reviewRequest } from '../src/schemas/ai';

/** Turns the engine's own facts into a two-sentence review and three next steps. */
export default createHandler({
  name: 'review-plan',
  schema: reviewRequest,
  run: async (input, { signal }) => {
    const userPrompt = `Review this plan summary and give next steps. Use only these facts, no invented numbers.\n\n${wrapUserText('facts', input.facts)}`;
    try {
      const { body, model } = await generateJson({
        name: 'review-plan',
        role: "you turn a planning engine's computed facts into a warm, short plan review.",
        userPrompt,
        schema: planReviewSchema,
        signal,
      });
      return { ...body, source: model };
    } catch {
      return { ...fallbackReview(input.facts), source: 'built-in' };
    }
  },
});
