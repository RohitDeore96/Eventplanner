export type TabId =
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
export const TABS: readonly TabId[] = [
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
const TAB_MOVEMENT_KEYS = ['ArrowRight', 'ArrowLeft', 'Home', 'End'] as const;

/**
 * Keyboard support for the ARIA tabs pattern beyond plain Tab/Enter: arrow keys move
 * between tabs (wrapping) and activate them, Home/End jump to the ends. Tab itself is
 * left as a native stop on each button, so both navigation habits work.
 */
export function onTabListKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
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
