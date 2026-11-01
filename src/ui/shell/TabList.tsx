import { translate, type Lang } from '../../lib/i18n';
import { onTabListKeyDown, TABS, type TabId } from './tabs';

export function TabList({
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
  // ARIA APG tabs pattern: the tablist CONTAINER is not a tab stop — the tab buttons
  // below carry the roving tabindex and arrow-key navigation, so adding tabIndex here
  // would insert a redundant stop. The rule cannot see child focusability.
  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
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
