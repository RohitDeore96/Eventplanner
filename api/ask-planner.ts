import { createHandler } from './_lib/http';
import { generateJson } from './_lib/gemini';
import { wrapUserText } from './_lib/prompts';
import { fallbackAnswer } from './_lib/fallbacks';
import { askRequest, plannerAnswerSchema } from '../src/schemas/ai';

/** Ask-the-planner chat, grounded strictly in the plan facts the client sends. */
export default createHandler({
  name: 'ask-planner',
  schema: askRequest,
  run: async (input, { signal }) => {
    const userPrompt = `Answer the family's question using ONLY the plan facts below. If the facts do not contain the answer, say where in the app to look.\n\nPlan facts:\n${wrapUserText('facts', input.facts)}\n\nQuestion:\n${wrapUserText('question', input.question)}`;
    try {
      const { body, model } = await generateJson({
        name: 'ask-planner',
        role: "you answer families' questions about their event plan, in English or Hinglish, grounded in their plan facts only. Every reply is a suggestion, not an instruction.",
        userPrompt,
        schema: plannerAnswerSchema,
        signal,
      });
      return { ...body, source: model };
    } catch {
      return { answer: fallbackAnswer(input.question, input.facts), source: 'built-in' };
    }
  },
});
