import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
import { localToday } from '../lib/format';
import { clearSavedPlan, loadSavedPlan, savePlan } from '../state/persistence';
import { PlanContext, usePlanStore } from '../state/store';
import { BudgetView } from './views/BudgetView';
import { GuestsView } from './views/GuestsView';
import { SetupView } from './views/SetupView';
import { TimelineView } from './views/TimelineView';
import { VendorsView } from './views/VendorsView';

type TabId = 'setup' | 'budget' | 'timeline' | 'guests' | 'vendors';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'setup', label: 'Event' },
  { id: 'budget', label: 'Budget' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'guests', label: 'Guests' },
  { id: 'vendors', label: 'Vendors' },
];

/** Resets the error state when the user clicks again — recovery, not a dead end. */
class ErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  override state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown): { message: string } {
    return { message: error instanceof Error ? error.message : 'Something went wrong.' };
  }

  override componentDidCatch(): void {
    // Browser console logging is disabled by policy; the UI itself shows recovery.
  }

  override render() {
    if (this.state.message === null) return this.props.children;
    return (
      <div role="alert" className="card">
        <h2>The view hit a problem</h2>
        <p className="muted">{this.state.message}</p>
        <button
          type="button"
          className="primary"
          onClick={() => {
            this.setState({ message: null });
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

function Readiness({ plan }: { plan: Plan }) {
  const today = localToday();
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const done = summary.readiness.tasksDone;
  const total = summary.readiness.tasksTotal;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const label =
    summary.readiness.status === 'on_track'
      ? 'On track'
      : summary.readiness.status === 'at_risk'
        ? 'At risk'
        : 'Needs attention';
  return (
    <p className="readiness">
      <span className={`badge ${summary.readiness.status === 'on_track' ? 'success' : 'warn'}`}>
        <span aria-hidden="true">{summary.readiness.status === 'on_track' ? '✓' : '!'}</span>{' '}
        {label}
      </span>
      <progress max={100} value={pct} aria-label={`Plan readiness ${pct}%`} />
      <span>{pct}%</span>
    </p>
  );
}

function Shell({ plan }: { plan: Plan | null }) {
  const store = usePlanStore(localToday(), plan);
  const [hasPlan, setHasPlan] = useState(plan !== null);
  const [tab, setTab] = useState<TabId>(plan === null ? 'setup' : 'budget');
  // The store owns the plan from here on; the prop is only the seed (saved plan or null).
  const current = store.state.history.present;
  const view = !hasPlan ? 'setup' : tab;

  useEffect(() => {
    if (plan !== null) savePlan(current);
  }, [current, plan]);

  function resetAll() {
    clearSavedPlan();
    window.location.reload(); // the reload starts from empty storage
  }

  return (
    <PlanContext.Provider value={store}>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <img src="/logo.png" alt="" width={40} height={40} />
            <div>
              <span className="name">Utsav</span>
              <span className="tagline">Every utsav, one connected plan.</span>
            </div>
          </div>
          {hasPlan && <Readiness plan={current} />}
          {hasPlan && (
            <div className="row">
              <button
                type="button"
                onClick={() => {
                  store.undo();
                }}
                disabled={store.state.history.past.length === 0}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => {
                  store.redo();
                }}
                disabled={store.state.history.future.length === 0}
              >
                Redo
              </button>
              <button
                type="button"
                onClick={() => {
                  resetAll();
                }}
              >
                Reset
              </button>
            </div>
          )}
        </div>
      </header>
      <div className="layout">
        <nav aria-label="Plan sections">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={view === t.id}
                aria-controls={`panel-${t.id}`}
                disabled={!hasPlan && t.id !== 'setup'}
                onClick={() => {
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
        <main id="main">
          <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
            <ErrorBoundary key={view}>
              {view === 'setup' && (
                <SetupView
                  onCreated={() => {
                    setHasPlan(true);
                    setTab('budget');
                  }}
                  plan={hasPlan ? current : null}
                />
              )}
              {view === 'budget' && hasPlan && <BudgetView plan={current} />}
              {view === 'timeline' && hasPlan && <TimelineView plan={current} />}
              {view === 'guests' && hasPlan && <GuestsView plan={current} />}
              {view === 'vendors' && hasPlan && <VendorsView plan={current} />}
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </PlanContext.Provider>
  );
}

export function App() {
  const saved = useMemo(() => loadSavedPlan(), []);
  return <Shell plan={saved} />;
}
