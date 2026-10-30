import { createHandler } from './_lib/http.js';
import { generateJson } from './_lib/gemini.js';
import { wrapUserText } from './_lib/prompts.js';
import { aiPatchProposalSchema, patchRequest, patchProposalSchema } from '../src/schemas/ai.js';
import { parseMajorAmount } from '../src/engine/money.js';

/**
 * AI patch proposal (X1). The model suggests small, allowed changes; the ENGINE dry-runs
 * them in the browser and the user approves. The model never writes the plan directly,
 * and there is deliberately no fallback here: without AI, the family plans by hand.
 *
 * Money contract: the model states `amountMajor` / `plannedMajor` as decimal strings in
 * MAJOR units; THIS route converts each exactly once with the request currency and
 * answers with the engine-facing minor-unit proposal. A model amount that cannot convert
 * (wrong decimals for the currency) is rejected as AI_RESPONSE_INVALID — never guessed.
 */
export default createHandler({
  name: 'propose-patch',
  schema: patchRequest,
  run: async (input, { signal }) => {
    const userPrompt = [
      'Propose at most 10 small changes to improve this event plan, as a JSON patch.',
      'Allowed action types: task/add, task/update, task/delay, budget/move, category/add.',
      'Dates must be YYYY-MM-DD after ' + input.today + '.',
      'For budget/move and category/add, state the amount as a plain decimal-number STRING in',
      'MAJOR units of the plan currency ("20000" for 20,000) — never minor units.',
      'Only use categories and task ids that appear in the facts.',
      '',
      'Plan facts:',
      wrapUserText('facts', input.facts),
      '',
      'What the family asked for:',
      wrapUserText('instruction', input.instruction),
    ].join('\n');
    const { body, model } = await generateJson({
      name: 'propose-patch',
      role: 'you propose small, reversible planning changes. You never apply them; the app dry-runs every change and the family approves.',
      userPrompt,
      schema: aiPatchProposalSchema,
      signal,
    });
    const actions = body.actions.map((action) => {
      if (action.type === 'budget/move') {
        const amountMinor = parseMajorAmount(action.amountMajor, input.currency);
        if (amountMinor === null || amountMinor === 0) throw new Error('AI_RESPONSE_INVALID');
        return { ...action, amountMinor };
      }
      if (action.type === 'category/add') {
        const plannedMinor = parseMajorAmount(action.plannedMajor, input.currency);
        if (plannedMinor === null || plannedMinor === 0) throw new Error('AI_RESPONSE_INVALID');
        return { ...action, plannedMinor };
      }
      return action;
    });
    return { ...patchProposalSchema.parse({ summary: body.summary, actions }), source: model };
  },
});
