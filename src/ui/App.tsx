import { Component, useEffect, useMemo, useState, type ReactNode } from 'react';
import { summarize } from '../engine/summary';
import type { Plan } from '../engine/types';
import { localToday } from '../lib/format';
import {
  clearSavedPlan,
  savePlan,
  loadWorkspace,
  saveWorkspace,
  type RecoveryInfo,
  type Workspace,
} from '../state/persistence';
import { MAX_EVENTS } from '../config/limits';
import { duplicatePlan } from '../engine/duplicate';
import { buildDemoPlan } from '../state/demo';
import { deletePreferences } from '../state/prefs';
import { deleteQuotesFor } from '../state/quotes';
import { exportCsv, exportJson, exportSummary, exportTextFile } from '../lib/export';
import { LANGS, loadLang, storeLang, translate, type Lang } from '../lib/i18n';
import { PlanContext, usePlanStore } from '../state/store';
import { BudgetView } from './views/BudgetView';
import { GuestsView } from './views/GuestsView';
import { SetupView } from './views/SetupView';
import { TimelineView } from './views/TimelineView';
import { RunSheetView } from './views/RunSheetView';
import { AssistantView } from './views/AssistantView';
import { VendorsView } from './views/vendors';
import { CashflowView } from './views/CashflowView';
import { ActivityView } from './views/ActivityView';
import { EventsView } from './views/EventsView';

type TabId =
  | 'events'
  | 'setup'
  | 'budget'
  | 'timeline'
  | 'runsheet'
  | 'guests'
  | 'vendors'
  | 'cashflow'
  | 'activity'
  | 'assistant';

const TABS: readonly TabId[] = [
  'events',
  'setup',
  'budget',
  'timeline',
  'runsheet',
  'guests',
  'vendors',
  'cashflow',
  'activity',
  'assistant',
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

function Readiness({ plan, lang }: { plan: Plan; lang: Lang }) {
  const today = localToday();
  const summary = useMemo(() => summarize(plan, today), [plan, today]);
  const done = summary.readiness.tasksDone;
  const total = summary.readiness.tasksTotal;
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  const label =
    summary.readiness.status === 'on_track'
      ? translate(lang, 'readiness.onTrack')
      : summary.readiness.status === 'at_risk'
        ? translate(lang, 'readiness.atRisk')
        : translate(lang, 'readiness.needsAttention');
  return (
    <p className="readiness">
      <span className={`badge ${summary.readiness.status === 'on_track' ? 'success' : 'warn'}`}>
        <span aria-hidden="true">{summary.readiness.status === 'on_track' ? '✓' : '!'}</span>{' '}
        {label}
      </span>
      <progress max={100} value={pct} aria-label={`${translate(lang, 'readiness.aria')} ${pct}%`} />
      <span>{pct}%</span>
    </p>
  );
}

function HeaderControls({
  store,
  hasPlan,
  lang,
  onLang,
}: {
  store: ReturnType<typeof usePlanStore>;
  hasPlan: boolean;
  lang: Lang;
  onLang: (lang: Lang) => void;
}): React.ReactNode {
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <div className="row">
      <label className="lang-picker">
        <span className="muted">{translate(lang, 'header.language')}</span>
        <select
          value={lang}
          aria-label={translate(lang, 'header.language')}
          onChange={(event) => {
            const next = event.target.value;
            if (next === 'en' || next === 'hi' || next === 'mr') onLang(next);
          }}
        >
          {LANGS.map((option) => (
            <option key={option.id} value={option.id} lang={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
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
          {translate(lang, 'header.loadDemo')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportJson(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportJson')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportCsv(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportCsv')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            exportSummary(store.state.history.present);
          }}
        >
          {translate(lang, 'header.exportSummary')}
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
          {translate(lang, 'header.undo')}
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
          {translate(lang, 'header.redo')}
        </button>
      )}
      {hasPlan && (
        <button
          type="button"
          onClick={() => {
            setConfirmReset(true);
          }}
        >
          {translate(lang, 'header.reset')}
        </button>
      )}
      {hasPlan && confirmReset && (
        <>
          <button
            type="button"
            className="danger"
            onClick={() => {
              clearSavedPlan();
              window.location.reload();
            }}
          >
            {translate(lang, 'header.resetConfirm')}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirmReset(false);
            }}
          >
            {translate(lang, 'header.resetCancel')}
          </button>
        </>
      )}
    </div>
  );
}

const TAB_MOVEMENT_KEYS = ['ArrowRight', 'ArrowLeft', 'Home', 'End'] as const;

/**
 * Keyboard support for the ARIA tabs pattern beyond plain Tab/Enter: arrow keys move
 * between tabs (wrapping) and activate them, Home/End jump to the ends. Tab itself is
 * left as a native stop on each button, so both navigation habits work.
 */
function onTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  if (!(TAB_MOVEMENT_KEYS as readonly string[]).includes(event.key)) return;
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'),
  );
  if (tabs.length === 0) return;
  const currentIndex = Math.max(
    0,
    tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'),
  );
  const nextIndex =
    event.key === 'ArrowRight'
      ? (currentIndex + 1) % tabs.length
      : event.key === 'ArrowLeft'
        ? (currentIndex - 1 + tabs.length) % tabs.length
        : event.key === 'Home'
          ? 0
          : tabs.length - 1;
  const next = tabs[nextIndex];
  if (next === undefined) return;
  event.preventDefault();
  next.focus();
  next.click();
}

function TabList({
  active,
  hasPlan,
  lang,
  onSelect,
}: {
  active: TabId;
  hasPlan: boolean;
  lang: Lang;
  onSelect: (tab: TabId) => void;
}): React.ReactNode {
  return (
    <div className="tabs" role="tablist" onKeyDown={onTabListKeyDown}>
      {TABS.map((tabId) => (
        <button
          key={tabId}
          role="tab"
          id={`tab-${tabId}`}
          aria-selected={active === tabId}
          aria-controls={`panel-${tabId}`}
          disabled={!hasPlan && tabId !== 'setup' && tabId !== 'events'}
          onClick={() => {
            onSelect(tabId);
          }}
        >
          {translate(lang, `tab.${tabId}`)}
        </button>
      ))}
    </div>
  );
}

function ViewSwitch({
  view,
  hasPlan,
  creatingNew,
  plan,
  events,
  activeId,
  archivedIds,
  onOpen,
  onDelete,
  onNew,
  onDuplicate,
  onArchive,
  onRestore,
  onCreated,
}: {
  view: TabId;
  hasPlan: boolean;
  creatingNew: boolean;
  plan: Plan;
  events: readonly Plan[];
  activeId: string | null;
  archivedIds: readonly string[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onDuplicate: (id: string) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onCreated: () => void;
}): React.ReactNode {
  if (!hasPlan || view === 'setup') {
    return <SetupView onCreated={onCreated} plan={hasPlan && !creatingNew ? plan : null} />;
  }
  switch (view) {
    case 'events':
      return (
        <EventsView
          events={events}
          activeId={activeId}
          archivedIds={archivedIds}
          onOpen={onOpen}
          onDelete={onDelete}
          onNew={onNew}
          onDuplicate={onDuplicate}
          onArchive={onArchive}
          onRestore={onRestore}
          canCreate={events.length < MAX_EVENTS}
        />
      );
    case 'timeline':
      return <TimelineView plan={plan} />;
    case 'runsheet':
      return <RunSheetView plan={plan} />;
    case 'guests':
      return <GuestsView plan={plan} />;
    case 'vendors':
      return <VendorsView plan={plan} />;
    case 'cashflow':
      return <CashflowView plan={plan} />;
    case 'assistant':
      return <AssistantView plan={plan} />;
    case 'activity':
      return <ActivityView />;
    case 'budget':
      return <BudgetView plan={plan} />;
    default:
      return <SetupView onCreated={onCreated} plan={null} />;
  }
}

const RECOVERY_REASONS: Record<RecoveryInfo['reason'], string> = {
  unreadable: 'The saved events in this browser are not readable (the data is corrupted).',
  too_large: 'The saved events in this browser are too large to load.',
  newer_version:
    'The saved events were written by a newer version of Utsav, so they were not loaded here.',
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

function Shell({ workspace }: { workspace: Workspace }) {
  const seed = workspace.plans.find((p) => p.id === workspace.activeId) ?? null;
  const store = usePlanStore(localToday(), seed);
  const [events, setEvents] = useState<readonly Plan[]>(workspace.plans);
  const [activeId, setActiveId] = useState<string | null>(workspace.activeId);
  const [archivedIds, setArchivedIds] = useState<readonly string[]>(workspace.archivedIds);
  const [creatingNew, setCreatingNew] = useState(false);
  const [tab, setTab] = useState<TabId>(seed === null ? 'setup' : 'budget');
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  // One-off action feedback (duplicate created, event archived): the autosave effect owns
  // `saveNotice`, so anything it could wipe lives here instead.
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [lang, setLang] = useState<Lang>(() => loadLang());
  // The document language follows the label language, for screen readers.
  useEffect(() => {
    document.documentElement.lang = lang === 'en' ? 'en' : lang;
  }, [lang]);
  // The store owns the ACTIVE plan from here on; `events` mirrors what storage holds.
  const current = store.state.history.present;
  const activeIsArchived = activeId !== null && archivedIds.includes(activeId);
  const hasPlan = activeId !== null && events.some((p) => p.id === activeId) && !activeIsArchived;
  const droppedNotice =
    workspace.droppedInvalid > 0
      ? `${workspace.droppedInvalid} saved event(s) failed their safety checks and were not loaded.`
      : null;

  // Autosave follows the ACTIVE plan's lifecycle: every change, undo, redo and event
  // switch writes the whole workspace, with `current` replacing its own stored copy.
  // Archived events are never open, so they are never the active plan here.
  useEffect(() => {
    if (!hasPlan) return;
    const plans = events.map((p) => (p.id === activeId ? current : p));
    const status = saveWorkspace(plans, activeId, archivedIds);
    setSaveNotice(status.ok ? null : (status.reason ?? 'Your latest change was not saved.'));
  }, [current, hasPlan, events, activeId, archivedIds]);

  function persist(
    plans: readonly Plan[],
    nextActive: string | null,
    nextArchived: readonly string[] = archivedIds,
  ): void {
    const status = saveWorkspace(plans, nextActive, nextArchived);
    setSaveNotice(status.ok ? null : (status.reason ?? 'Your latest change was not saved.'));
  }

  function openEvent(id: string): void {
    if (archivedIds.includes(id)) return;
    const target = events.find((p) => p.id === id);
    if (target === undefined) return;
    // Persist the plan we are leaving under ITS id first, then move the active marker.
    const withCurrent = events.map((p) => (p.id === activeId ? current : p));
    persist(withCurrent, id);
    setEvents(withCurrent);
    setActiveId(id);
    setCreatingNew(false);
    setTab('budget');
    store.replace(target);
  }

  function deleteEvent(id: string): void {
    const remaining = events.filter((p) => p.id !== id);
    const nextArchived = archivedIds.filter((archived) => archived !== id);
    if (id === activeId) {
      const nextActive = remaining.find((p) => !nextArchived.includes(p.id))?.id ?? null;
      persist(remaining, nextActive, nextArchived);
      setEvents(remaining);
      setArchivedIds(nextArchived);
      setActiveId(nextActive);
      if (nextActive !== null) {
        const target = remaining.find((p) => p.id === nextActive);
        if (target !== undefined) store.replace(target);
        setTab('budget');
      } else {
        setTab('setup');
      }
    } else {
      persist(remaining, activeId, nextArchived);
      setEvents(remaining);
      setArchivedIds(nextArchived);
    }
    // A deleted event's quotations and preferences are dead data; clear them too.
    deleteQuotesFor(id);
    deletePreferences(id);
  }

  function duplicateEvent(id: string): void {
    const source = events.find((p) => p.id === id);
    if (source === undefined) return;
    if (events.length >= MAX_EVENTS) {
      setSaveNotice(`Utsav keeps up to ${MAX_EVENTS} events in one browser — delete one first.`);
      return;
    }
    const copy = duplicatePlan(source, `ev-${Date.now().toString(36)}-copy`);
    if (!copy.ok) {
      setActionNotice(copy.error.message);
      return;
    }
    const withCopy = [...events.map((p) => (p.id === activeId ? current : p)), copy.value];
    persist(withCopy, activeId);
    setEvents(withCopy);
    setActionNotice(`Created “${copy.value.name}” — open it from the events list.`);
  }

  function archiveEvent(id: string): void {
    if (archivedIds.includes(id)) return;
    const nextArchived = [...archivedIds, id];
    if (id === activeId) {
      const nextActive =
        events.find((p) => p.id !== id && !nextArchived.includes(p.id))?.id ?? null;
      const withCurrent = events.map((p) => (p.id === activeId ? current : p));
      persist(withCurrent, nextActive, nextArchived);
      setEvents(withCurrent);
      setArchivedIds(nextArchived);
      setActiveId(nextActive);
      if (nextActive !== null) {
        const target = withCurrent.find((p) => p.id === nextActive);
        if (target !== undefined) store.replace(target);
        setTab('budget');
      } else {
        setTab('setup');
      }
      return;
    }
    const withCurrent = events.map((p) => (p.id === activeId ? current : p));
    persist(withCurrent, activeId, nextArchived);
    setEvents(withCurrent);
    setArchivedIds(nextArchived);
  }

  function restoreEvent(id: string): void {
    if (!archivedIds.includes(id)) return;
    const nextArchived = archivedIds.filter((archived) => archived !== id);
    persist(events, activeId, nextArchived);
    setArchivedIds(nextArchived);
  }

  return (
    <PlanContext.Provider value={store}>
      <a className="skip-link" href="#main">
        {translate(lang, 'a11y.skip')}
      </a>
      <header className="masthead">
        <div className="masthead-inner">
          <div className="brand">
            <img src="/logo.png" alt="" width={40} height={40} />
            <div>
              {/* Single page heading: the product name. Styled by .brand .name. */}
              <h1 className="name">Utsav</h1>
              <p className="tagline">Every utsav, one connected plan.</p>
            </div>
          </div>
          {hasPlan && <Readiness plan={current} lang={lang} />}
          <HeaderControls
            store={store}
            hasPlan={hasPlan}
            lang={lang}
            onLang={(next) => {
              setLang(next);
              storeLang(next);
            }}
          />
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
        {actionNotice !== null && (
          <p className="alert" role="status">
            <strong>
              <span aria-hidden="true">✓</span> {actionNotice}
            </strong>
          </p>
        )}
      </header>
      <div className="layout">
        {workspace.recovery !== null && <RecoveryNotice recovery={workspace.recovery} />}
        {droppedNotice !== null && (
          <p className="alert" role="status">
            <strong>
              <span aria-hidden="true">⚠️</span> {droppedNotice}
            </strong>{' '}
            Nothing else was changed.
          </p>
        )}
        <nav aria-label="Plan sections">
          <TabList
            active={tab}
            hasPlan={hasPlan}
            lang={lang}
            onSelect={(next) => {
              setCreatingNew(false);
              setTab(next);
            }}
          />
        </nav>
        {/* tabIndex -1 lets the skip link move real focus here on activation. */}
        <main id="main" tabIndex={-1}>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            <ErrorBoundary key={tab}>
              <ViewSwitch
                view={hasPlan ? tab : 'setup'}
                hasPlan={hasPlan}
                creatingNew={creatingNew}
                plan={current}
                events={events}
                activeId={activeId}
                archivedIds={archivedIds}
                onOpen={openEvent}
                onDelete={deleteEvent}
                onNew={() => {
                  setCreatingNew(true);
                  setTab('setup');
                }}
                onDuplicate={duplicateEvent}
                onArchive={archiveEvent}
                onRestore={restoreEvent}
                onCreated={() => {
                  // SetupView saved the new plan through savePlan(); re-read the workspace.
                  const fresh = loadWorkspace();
                  setEvents(fresh.plans);
                  setActiveId(fresh.activeId);
                  setArchivedIds(fresh.archivedIds);
                  setCreatingNew(false);
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
  const saved = useMemo(() => loadWorkspace(), []);
  return <Shell workspace={saved} />;
}
