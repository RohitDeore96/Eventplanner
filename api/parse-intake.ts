import { createHandler } from './_lib/http.js';
import { generateJson } from './_lib/gemini.js';
import { wrapUserText } from './_lib/prompts.js';
import { fallbackIntake } from './_lib/fallbacks.js';
import { intakeParseSchema, parseIntakeRequest } from '../src/schemas/ai.js';

/** Free-text event description -> structured intake fields (nulls when unstated). */
export default createHandler({
  name: 'parse-intake',
  schema: parseIntakeRequest,
  run: async (input, { signal }) => {
    const userPrompt = `Read this event description and extract the fields. Use null for anything not stated.\n\n${wrapUserText('intake', input.text)}`;
    try {
      const { body, model } = await generateJson({
        name: 'parse-intake',
        role: "you read a family member's free-text event description and fill a structured form.",
        userPrompt,
        schema: intakeParseSchema,
        signal,
      });
      return { ...body, source: model };
    } catch {
      return { ...fallbackIntake(input.text), source: 'built-in' };
    }
  },
});
