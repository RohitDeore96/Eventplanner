import { MAX_EVENTS } from '../../config/limits';
import type { Plan } from '../../engine/types';
import { ActivityView } from '../views/ActivityView';
import { AssistantView } from '../views/AssistantView';
import { BudgetView } from '../views/budget';
import { CashflowView } from '../views/CashflowView';
import { EventsView } from '../views/EventsView';
import { GuestsView } from '../views/GuestsView';
import { RunSheetView } from '../views/RunSheetView';
import { SetupView } from '../views/SetupView';
import { TimelineView } from '../views/TimelineView';
import { VendorsView } from '../views/vendors';
import type { TabId } from './tabs';

export function ViewSwitch({
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
