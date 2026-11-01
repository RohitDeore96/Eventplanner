import { useEffect, useState } from 'react';
import { MAX_EVENTS } from '../../config/limits';
import { duplicatePlan } from '../../engine/duplicate';
import type { Plan } from '../../engine/types';
import { localToday } from '../../lib/format';
import { loadLang, storeLang, translate, type Lang } from '../../lib/i18n';
import { loadWorkspace, saveWorkspace, type Workspace } from '../../state/persistence';
import { deletePreferences } from '../../state/prefs';
import { deleteQuotesFor } from '../../state/quotes';
import { PlanContext, usePlanStore } from '../../state/store';
import { ErrorBoundary } from './ErrorBoundary';
import { RecoveryNotice } from './RecoveryNotice';
import { SessionNotice } from './SessionNotice';
import { Masthead } from './Masthead';
import { TabList } from './TabList';
import type { TabId } from './tabs';
import { ViewSwitch } from './ViewSwitch';

export function Shell({
  workspace,
  sessionOnly = false,
  onSessionContinue,
}: {
  workspace: Workspace;
  /** True after the family chose to continue without storage for this session. */
  sessionOnly?: boolean;
  /** The recovery notice's explicit "continue for this session" action. */
  onSessionContinue: () => void;
}) {
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
    // The notice reports the result of the external-system write (localStorage) — the
    // setState here IS the synchronization outcome, not derived state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <Masthead
        store={store}
        hasPlan={hasPlan}
        lang={lang}
        onLang={(next) => {
          setLang(next);
          storeLang(next);
        }}
        current={current}
        saveNotice={saveNotice}
        actionNotice={actionNotice}
      />
      <div className="layout">
        {workspace.recovery !== null && (
          <RecoveryNotice recovery={workspace.recovery} onSessionContinue={onSessionContinue} />
        )}
        <SessionNotice show={sessionOnly} lang={lang} />
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
