import { useEffect, useMemo, useState } from 'react';
import type { Plan } from '../../engine/types';
import { budgetTotals } from '../../engine/budget';
import { localToday } from '../../lib/format';
import { planFacts } from '../../lib/facts';
import { aiClient, type AiReply } from '../../lib/aiClient';
import {
  EMPTY_PREFERENCES,
  loadPreferences,
  savePreferences,
  type EventPreferences,
} from '../../state/prefs';
import { AiPatchPanel } from './AiPatchPanel';

type IdeasReply = AiReply<{
  themes: string[];
  activities: string[];
  foodStyle: string[];
  personalTouches: string[];
  source: string;
}>;

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

  const [ideas, setIdeas] = useState<IdeasReply | null>(null);
  const [ideasBusy, setIdeasBusy] = useState(false);
  const [ideasNotice, setIdeasNotice] = useState<string | null>(null);
  // Saved per-event preferences (M9): they persist with the event and drive the suggestions.
  const [prefs, setPrefs] = useState<EventPreferences>(EMPTY_PREFERENCES);
  const [prefsNotice, setPrefsNotice] = useState<string | null>(null);
  useEffect(() => {
    setPrefs(loadPreferences(plan.id));
  }, [plan.id]);

  function updatePrefs(patch: Partial<EventPreferences>): void {
    setPrefs((current) => {
      const next = { ...current, ...patch };
      const saved = savePreferences(plan.id, next);
      setPrefsNotice(
        saved ? 'Preferences saved with this event.' : 'Preferences could not be saved.',
      );
      return next;
    });
  }

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

  async function runIdeas() {
    setIdeasBusy(true);
    setIdeasNotice(null);
    try {
      const totals = budgetTotals(plan);
      setIdeas(
        await aiClient.ideas(plan.occasion, prefs.vibe.trim(), plan.guestTarget, {
          budgetMinor: plan.budgetMinor,
          notes: prefs.priorities.trim(),
          ...(prefs.formality === '' ? {} : { formality: prefs.formality }),
          ...(prefs.budgetTier === '' ? {} : { budgetTier: prefs.budgetTier }),
          ...(prefs.mustHaves.trim().length > 0 ? { mustHaves: prefs.mustHaves.trim() } : {}),
          remainingBudgetMinor: Math.max(0, totals.budget - totals.committed),
          bookedVendors: plan.vendors.filter((v) => v.status === 'booked').length,
        }),
      );
    } catch {
      setIdeasNotice('Ideas are offline. Try again later.');
    } finally {
      setIdeasBusy(false);
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

      <section className="card" aria-labelledby="ideas-title">
        <h2 id="ideas-title">Ideas from your preferences</h2>
        <p className="muted">
          Tuned to this event's occasion, budget reality and the preferences below — which are saved
          with the event, so they survive reloads.
        </p>
        <div className="grid">
          <div>
            <label htmlFor="ideas-vibe">Style or theme you want (your own words)</label>
            <input
              id="ideas-vibe"
              value={prefs.vibe}
              maxLength={200}
              placeholder="e.g. pastel evening, marigold, cricket theme"
              onChange={(event) => {
                updatePrefs({ vibe: event.target.value });
              }}
            />
          </div>
          <div>
            <label htmlFor="ideas-formality">Formality</label>
            <select
              id="ideas-formality"
              value={prefs.formality}
              onChange={(event) => {
                updatePrefs({ formality: event.target.value as EventPreferences['formality'] });
              }}
            >
              <option value="">Not set</option>
              <option value="relaxed">Relaxed and homely</option>
              <option value="traditional">Traditional</option>
              <option value="formal">Formal</option>
            </select>
          </div>
          <div>
            <label htmlFor="ideas-tier">Budget tier</label>
            <select
              id="ideas-tier"
              value={prefs.budgetTier}
              onChange={(event) => {
                updatePrefs({ budgetTier: event.target.value as EventPreferences['budgetTier'] });
              }}
            >
              <option value="">Not set</option>
              <option value="value">Value — keep it lean</option>
              <option value="balanced">Balanced</option>
              <option value="premium">Premium</option>
            </select>
          </div>
          <div>
            <label htmlFor="ideas-must">Must-haves (non-negotiable)</label>
            <input
              id="ideas-must"
              value={prefs.mustHaves}
              maxLength={300}
              placeholder="e.g. live sitar, jain counter, grandmother seats first row"
              onChange={(event) => {
                updatePrefs({ mustHaves: event.target.value });
              }}
            />
          </div>
          <div>
            <label htmlFor="ideas-notes">Priorities, place or traditions (optional)</label>
            <input
              id="ideas-notes"
              value={prefs.priorities}
              maxLength={300}
              placeholder="e.g. mostly elders, want a haldi at home, Pune"
              onChange={(event) => {
                updatePrefs({ priorities: event.target.value });
              }}
            />
          </div>
        </div>
        {prefsNotice !== null && (
          <p className="muted" role="status">
            {prefsNotice}
          </p>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => {
            void runIdeas();
          }}
          disabled={ideasBusy}
        >
          {ideasBusy ? 'Thinking…' : ideas === null ? 'Suggest ideas' : 'Regenerate ideas'}
        </button>
        {ideasNotice !== null && (
          <p className="muted" role="status">
            {ideasNotice}
          </p>
        )}
        {ideas !== null && (
          <div aria-live="polite">
            <IdeasList title="Themes" items={ideas.body.themes} />
            <IdeasList title="Activities" items={ideas.body.activities} />
            <IdeasList title="Food style" items={ideas.body.foodStyle} />
            <IdeasList title="Personal touches" items={ideas.body.personalTouches} />
            <p className="muted">Ideas by {ideas.source} — no prices, ever.</p>
          </div>
        )}
      </section>

      <AiPatchPanel plan={plan} />
    </>
  );
}

function IdeasList({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
