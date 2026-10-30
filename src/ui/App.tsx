import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
import { localToday } from '../lib/format';
import { clearSavedPlan, loadSavedState, savePlan, type RecoveryInfo } from '../state/persistence';
import { buildDemoPlan } from '../state/demo';
import { exportCsv, exportJson, exportTextFile } from '../lib/export';
import { PlanContext, usePlanStore } from '../state/store';
import { BudgetView } from './views/BudgetView';
import { GuestsView } from './views/GuestsView';
import { SetupView } from './views/SetupView';
import { TimelineView } from './views/TimelineView';
import { AssistantView } from './views/AssistantView';
import { VendorsView } from './views/VendorsView';

type TabId = 'setup' | 'budget' | 'timeline' | 'guests' | 'vendors' | 'assistant';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  { id: 'setup', label: 'Event' },
  { id: 'budget', label: 'Budget' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'guests', label: 'Guests' },
  { id: 'vendors', label: 'Vendors' },
  { id: 'assistant', label: 'Assistant' },
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

function HeaderControls({
  store,
  hasPlan,
}: {
  store: ReturnType<typeof usePlanStore>;
  hasPlan: boolean;
}): React.ReactNode {
  return (
    <div className="row">
      {!hasPlan && (
        <button
          type="button"
          onClick={() => {
            const demo = buildDemoPlan(localToday());
            if (demo !== null) {
              savePlan(demo);
              store.replace(demo);
              window.location.reload();
            }
          }}
        >
          Load demo event
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportJson(store.state.history.present);
          }}
        >
          Export JSON
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportCsv(store.state.history.present);
          }}
        >
          Export CSV
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            store.undo();
          }}
          disabled={store.state.history.past.length === 0}
        >
          Undo
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            store.redo();
          }}
          disabled={store.state.history.future.length === 0}
        >
          Redo
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            clearSavedPlan();
            window.location.reload();
          }}
        >
          Reset
        </button>
      )}
    </div>
  );
}

function TabList({
  active,
  hasPlan,
  onSelect,
}: {
  active: TabId;
  hasPlan: boolean;
  onSelect: (tab: TabId) => void;
}): React.ReactNode {
  return (
    <div className="tabs" role="tablist">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          id={`tab-${tab.id}`}
          aria-selected={active === tab.id}
          aria-controls={`panel-${tab.id}`}
          disabled={!hasPlan && tab.id !== 'setup'}
          onClick={() => {
            onSelect(tab.id);
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ViewSwitch({
  view,
  hasPlan,
  plan,
  onCreated,
}: {
  view: TabId;
  hasPlan: boolean;
  plan: Plan;
  onCreated: () => void;
}): React.ReactNode {
  if (!hasPlan || view === 'setup') {
    return <SetupView onCreated={onCreated} plan={hasPlan ? plan : null} />;
  }
  switch (view) {
    case 'timeline':
      return <TimelineView plan={plan} />;
    case 'guests':
      return <GuestsView plan={plan} />;
    case 'vendors':
      return <VendorsView plan={plan} />;
    case 'assistant':
      return <AssistantView plan={plan} />;
    case 'budget':
      return <BudgetView plan={plan} />;
    default:
      return <SetupView onCreated={onCreated} plan={null} />;
  }
}

const RECOVERY_REASONS: Record<RecoveryInfo['reason'], string> = {
  unreadable: 'The saved plan in this browser is not readable (the data is corrupted).',
  too_large: 'The saved plan in this browser is too large to load.',
  newer_version:
    'The saved plan was written by a newer version of Utsav, so it was not loaded here.',
  invalid: 'The saved plan failed its safety checks, so it was not loaded into the app.',
};

/**
 * Recovery path for untrusted stored data: never loaded into the app, never deleted
 * silently. The family can keep an exportable copy of exactly what was stored, then
 * start fresh when ready.
 */
function RecoveryNotice({ recovery }: { recovery: RecoveryInfo }): React.ReactNode {
  return (
    <section className="card" role="alert" aria-labelledby="recovery-title">
      <h2 id="recovery-title">Your saved plan needs attention</h2>
      <p className="muted">
        {RECOVERY_REASONS[recovery.reason]} Nothing in this browser was changed. Download a copy of
        the stored data if you want to keep it, then start fresh.
      </p>
      <div className="row">
        <button
          type="button"
          onClick={() => {
            exportTextFile('utsav-recovered-plan.json', recovery.raw);
          }}
        >
          Download a copy
        </button>
        <button
          type="button"
          onClick={() => {
            clearSavedPlan();
            window.location.reload();
          }}
        >
          Start fresh
        </button>
      </div>
    </section>
  );
}

function Shell({ plan, recovery }: { plan: Plan | null; recovery: RecoveryInfo | null }) {
  const store = usePlanStore(localToday(), plan);
  const [hasPlan, setHasPlan] = useState(plan !== null);
  const [tab, setTab] = useState<TabId>(plan === null ? 'setup' : 'budget');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // The store owns the plan from here on; the prop is only the seed (saved plan or null).
  const current = store.state.history.present;
  const view = !hasPlan ? 'setup' : tab;

  // Autosave follows the ACTIVE plan's lifecycle, not the seed prop: once a plan exists
  // (created in this session or loaded), every change, undo and redo is saved. A failed
  // write surfaces a clear, recoverable message instead of being swallowed.
  useEffect(() => {
    if (!hasPlan) return;
    const status = savePlan(current);
    setSaveNotice(status.ok ? null : (status.reason ?? 'Your latest change was not saved.'));
  }, [current, hasPlan]);

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
          <HeaderControls store={store} hasPlan={hasPlan} />
        </div>
        {saveNotice !== null && (
          <p className="alert" role="status">
            <strong>
              <span aria-hidden="true">⚠️</span> {saveNotice}
            </strong>{' '}
            Your plan is still open — export JSON to keep a copy, or free up browser storage and
            make a change to autosave again.
          </p>
        )}
      </header>
      <div className="layout">
        {recovery !== null && <RecoveryNotice recovery={recovery} />}
        <nav aria-label="Plan sections">
          <TabList active={view} hasPlan={hasPlan} onSelect={setTab} />
        </nav>
        <main id="main">
          <div role="tabpanel" id={`panel-${view}`} aria-labelledby={`tab-${view}`}>
            <ErrorBoundary key={view}>
              <ViewSwitch
                view={view}
                hasPlan={hasPlan}
                plan={current}
                onCreated={() => {
                  setHasPlan(true);
                  setTab('budget');
                }}
              />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </PlanContext.Provider>
  );
}

export function App() {
  const saved = useMemo(() => loadSavedState(), []);
  return <Shell plan={saved.plan} recovery={saved.recovery} />;
}
