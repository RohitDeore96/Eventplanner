import { useMemo, useState } from 'react';
import type { Plan } from '../../engine/types';
import { localToday } from '../../lib/format';
import { planFacts } from '../../lib/facts';
import { aiClient, type AiReply } from '../../lib/aiClient';
import { AiPatchPanel } from './AiPatchPanel';
import { IdeasSection } from './assistant/IdeasSection';

/** The assistant: plan review, ask-the-planner, ideas, and the AI patch flow (X1). */
export function AssistantView({ plan }: { plan: Plan }) {
  const today = useMemo(() => localToday(), []);
  const [review, setReview] = useState<AiReply<{
    summary: string;
    nextSteps: string[];
    source: string;
  }> | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNotice, setReviewNotice] = useState<string | null>(null);

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<{ text: string; source: string } | null>(null);
  const [askBusy, setAskBusy] = useState(false);

  const facts = useMemo(() => planFacts(plan, today), [plan, today]);

  async function runReview() {
    setReviewBusy(true);
    setReviewNotice(null);
    try {
      setReview(await aiClient.review(facts));
    } catch {
      setReviewNotice('The review service is unavailable — the warnings list below always works.');
    } finally {
      setReviewBusy(false);
    }
  }

  async function runAsk() {
    setAskBusy(true);
    try {
      const reply = await aiClient.ask(question, facts);
      setAnswer({ text: reply.body.answer, source: reply.source });
    } catch {
      setAnswer({
        text: 'The planner is offline. The warnings and readiness bar keep working without AI.',
        source: 'built-in',
      });
    } finally {
      setAskBusy(false);
    }
  }

  return (
    <>
      <section className="card" aria-labelledby="assistant-title">
        <h2 id="assistant-title">Plan review</h2>
        <p className="muted">{facts.split('\n').slice(0, 3).join(' ')}</p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            void runReview();
          }}
          disabled={reviewBusy}
        >
          {reviewBusy ? 'Reading your plan…' : 'Ask AI for a plan review'}
        </button>
        {reviewNotice !== null && (
          <p className="muted" role="status">
            {reviewNotice}
          </p>
        )}
        {review !== null && (
          <div aria-live="polite">
            <p>{review.body.summary}</p>
            <ol>
              {review.body.nextSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="muted">Suggestion by {review.source} — review before acting.</p>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="ask-title">
        <h2 id="ask-title">Ask the planner</h2>
        <label htmlFor="ask-question">Ask about your plan ("Kitna kharcha bacha hai?")</label>
        <input
          id="ask-question"
          value={question}
          maxLength={500}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
        <button
          type="button"
          className="primary"
          onClick={() => {
            void runAsk();
          }}
          disabled={askBusy || question.trim().length === 0}
        >
          {askBusy ? 'Thinking…' : 'Ask'}
        </button>
        {answer !== null && (
          <div role="status" aria-live="polite">
            <p>{answer.text}</p>
            <p className="muted">
              Answered by {answer.source} — a suggestion based on your plan's numbers.
            </p>
          </div>
        )}
      </section>

      <IdeasSection plan={plan} />

      <AiPatchPanel plan={plan} />
    </>
  );
}
