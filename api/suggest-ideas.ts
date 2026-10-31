import { createHandler } from './_lib/http.js';
import { generateJson } from './_lib/gemini.js';
import { wrapUserText } from './_lib/prompts.js';
import { fallbackIdeas } from './_lib/fallbacks.js';
import { ideasRequest, ideasSchema } from '../src/schemas/ai.js';

/**
 * Personalized ideas: themes, activities, food style, personal touches — driven by the
 * occasion, the family's own preferences and the plan's real guest count. No prices, ever.
 */
export default createHandler({
  name: 'suggest-ideas',
  schema: ideasRequest,
  run: async (input, { signal }) => {
    const context = [
      `Occasion: ${input.occasion}`,
      `Guests: ${input.guests}`,
      `Preferences (the family's own words): ${wrapUserText('vibe', input.vibe || 'unspecified')}`,
      input.budgetMinor !== undefined && input.budgetMinor > 0
        ? 'Budget exists in the plan: keep suggestions achievable for a real family budget; never state amounts.'
        : '',
      input.notes !== undefined && input.notes.length > 0
        ? `Priorities and context: ${wrapUserText('notes', input.notes)}`
        : '',
      input.formality !== undefined
        ? `Formality: ${input.formality}. Match the tone of the suggestions to it.`
        : '',
      input.budgetTier !== undefined
        ? `Budget tier: ${input.budgetTier}. Keep suggestions realistic for that tier; never state amounts.`
        : '',
      input.mustHaves !== undefined && input.mustHaves.length > 0
        ? `Must-haves (non-negotiable): ${wrapUserText('must-haves', input.mustHaves)}`
        : '',
      input.remainingBudgetMinor !== undefined
        ? 'Some budget is still unspent: at least one suggestion should fit what remains to spend; never state amounts.'
        : '',
      input.bookedVendors !== undefined && input.bookedVendors > 0
        ? `Some vendors are already booked (${input.bookedVendors}); do not suggest replacing confirmed services, and never invent vendor names.`
        : '',
    ]
      .filter((line) => line.length > 0)
      .join('\n');
    const userPrompt = `Suggest ideas for this event. Tune every suggestion to the occasion, the guest count and the family's stated preferences; when the preferences are empty, give broadly appealing ideas. Keep every suggestion under 12 words. No prices.\n${context}`;
    try {
      const { body, model } = await generateJson({
        name: 'suggest-ideas',
        role: 'you suggest celebration ideas tuned to the occasion and the family preferences. You never mention money.',
        userPrompt,
        schema: ideasSchema,
        signal,
      });
      return { ...body, source: model };
    } catch {
      return { ...fallbackIdeas(input.occasion), source: 'built-in' };
    }
  },
});
