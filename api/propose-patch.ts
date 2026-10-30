import { createHandler } from './_lib/http';
import { generateJson } from './_lib/gemini';
import { wrapUserText } from './_lib/prompts';
import { patchProposalSchema, patchRequest } from '../src/schemas/ai';

/**
 * AI patch proposal (X1). The model suggests small, allowed changes; the ENGINE dry-runs
 * them in the browser and the user approves. Gemini never writes the plan directly, and
 * there is deliberately no fallback here: without AI, the family plans by hand.
 */
export default createHandler({
  name: 'propose-patch',
  schema: patchRequest,
  run: async (input, { signal }) => {
    const userPrompt = `Propose at most 10 small changes to improve this event plan, as a JSON patch. Allowed action types: task/add, task/update, task/delay, budget/move, category/add. Dates must be YYYY-MM-DD after ${input.today}. Amounts are minor units. Only use categories and task ids that appear in the facts.\n\nPlan facts:\n${wrapUserText('facts', input.facts)}\n\nWhat the family asked for:\n${wrapUserText('instruction', input.instruction)}`;
    const { body, model } = await generateJson({
      name: 'propose-patch',
      role: 'you propose small, reversible planning changes. You never apply them; the app dry-runs every change and the family approves.',
      userPrompt,
      schema: patchProposalSchema,
      signal,
    });
    return { ...body, source: model };
  },
});
