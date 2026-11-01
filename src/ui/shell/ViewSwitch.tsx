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

const VIEW_RENDERERS: Readonly<Partial<Record<TabId, (plan: Plan) => React.ReactNode>>> = {
  timeline: (plan) => <TimelineView plan={plan} />,
  runsheet: (plan) => <RunSheetView plan={plan} />,
  guests: (plan) => <GuestsView plan={plan} />,
  vendors: (plan) => <VendorsView plan={plan} />,
  cashflow: (plan) => <CashflowView plan={plan} />,
  assistant: (plan) => <AssistantView plan={plan} />,
  activity: () => <ActivityView />,
  budget: (plan) => <BudgetView plan={plan} />,
};

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
  if (view === 'events') {
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
  }
  const render = VIEW_RENDERERS[view];
  return render !== undefined ? render(plan) : <SetupView onCreated={onCreated} plan={null} />;
}
