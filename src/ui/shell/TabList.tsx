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
