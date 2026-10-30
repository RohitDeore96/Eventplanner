import { createHandler } from './_lib/http.js';
import { generateJson } from './_lib/gemini.js';
import { wrapUserText } from './_lib/prompts.js';
import { fallbackIdeas } from './_lib/fallbacks.js';
import { ideasRequest, ideasSchema } from '../src/schemas/ai.js';

/** Occasion-tuned ideas: themes, activities, food style, personal touches. No prices, ever. */
export default createHandler({
  name: 'suggest-ideas',
  schema: ideasRequest,
  run: async (input, { signal }) => {
    const userPrompt = `Suggest ideas for this event. Keep every suggestion under 12 words. No prices.\nOccasion: ${input.occasion}\nVibe: ${wrapUserText('vibe', input.vibe)}\nGuests: ${input.guests}`;
    try {
      const { body, model } = await generateJson({
        name: 'suggest-ideas',
        role: 'you suggest celebration ideas tuned to the occasion and vibe. You never mention money.',
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
