import { createHandler } from './_lib/http.js';
import { generateJson } from './_lib/gemini.js';
import { wrapUserText } from './_lib/prompts.js';
import { fallbackIntake } from './_lib/fallbacks.js';
import { aiIntakeParseSchema, parseIntakeRequest } from '../src/schemas/ai.js';
import { majorToMinor } from '../src/engine/money.js';

/**
 * Free-text event description -> structured intake fields (nulls when unstated).
 *
 * Money contract: the model states the budget in MAJOR units (`budgetMajor`, exactly as the
 * human wrote it); THIS route converts to minor units exactly once, with the request's
 * currency. The response's `budgetMinor` is therefore always true minor units, and
 * `budgetMajor` never leaves the server.
 */
export default createHandler({
  name: 'parse-intake',
  schema: parseIntakeRequest,
  run: async (input, { signal }) => {
    const userPrompt = [
      'Read this event description and extract the fields. Use null for anything not stated.',
      'budgetMajor: the budget as a plain number in MAJOR units, exactly as stated in the text',
      '(for example "8 lakh budget" -> 800000; "8,00,000" -> 800000; "50 thousand yen" -> 50000).',
      `The currency is ${input.currency}; do NOT convert or guess minor units.`,
      `\n${wrapUserText('intake', input.text)}`,
    ].join('\n');
    try {
      const { body, model } = await generateJson({
        name: 'parse-intake',
        role: "you read a family member's free-text event description and fill a structured form.",
        userPrompt,
        schema: aiIntakeParseSchema,
        signal,
      });
      const { budgetMajor, ...rest } = body;
      return {
        ...rest,
        budgetMinor: budgetMajor === null ? null : majorToMinor(budgetMajor, input.currency),
        source: model,
      };
    } catch {
      return { ...fallbackIntake(input.text, input.currency), source: 'built-in' };
    }
  },
});
