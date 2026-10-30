import { createHandler } from './_lib/http';
import { generateJson } from './_lib/gemini';
import { wrapUserText } from './_lib/prompts';
import { fallbackIdeas } from './_lib/fallbacks';
import { ideasRequest, ideasSchema } from '../src/schemas/ai';

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
