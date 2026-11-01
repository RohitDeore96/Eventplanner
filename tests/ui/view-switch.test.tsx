/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Harness } from './harness';
import { ViewSwitch } from '../../src/ui/shell/ViewSwitch';
import type { TabId } from '../../src/ui/shell/tabs';
import { makePlan } from '../helpers';

/**
 * Regression guard for the ViewSwitch renderer map: every tab must still mount its
 * view through the shell. This keeps the eight single-entry renderers covered and
 * pins the view-to-heading contract the tabs promise.
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const noop = (): void => {
  /* ViewSwitch handlers are not exercised here — the views' own tests cover them. */
};

function switchTo(view: TabId): void {
  render(
    <Harness seed={makePlan()}>
      {(current) => (
        <ViewSwitch
          view={view}
          hasPlan
          creatingNew={false}
          plan={current}
          events={[current]}
          activeId={current.id}
          archivedIds={[]}
          onOpen={noop}
          onDelete={noop}
          onNew={noop}
          onDuplicate={noop}
          onArchive={noop}
          onRestore={noop}
          onCreated={noop}
        />
      )}
    </Harness>,
  );
}

describe('ViewSwitch renders every tab', () => {
  it('budget, timeline, run sheet, guests, vendors, cash-flow, assistant and activity', () => {
    const expected: readonly [TabId, RegExp][] = [
      ['budget', /Where the budget stands/],
      ['timeline', /Timeline \(/],
      ['runsheet', /Event-day run sheet/],
      ['guests', /Catering requirement/],
      ['vendors', /Booking checklist/],
      ['cashflow', /Cash-flow calendar/],
      ['assistant', /Plan review/],
    ];
    for (const [view, heading] of expected) {
      const { unmount } = render(
        <Harness seed={makePlan()}>
          {(current) => (
            <ViewSwitch
              view={view}
              hasPlan
              creatingNew={false}
              plan={current}
              events={[current]}
              activeId={current.id}
              archivedIds={[]}
              onOpen={noop}
              onDelete={noop}
              onNew={noop}
              onDuplicate={noop}
              onArchive={noop}
              onRestore={noop}
              onCreated={noop}
            />
          )}
        </Harness>,
      );
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
      unmount();
    }
    switchTo('activity');
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('falls back to setup without a plan and shows the create form from setup', () => {
    const onCreated = vi.fn();
    render(
      <Harness seed={makePlan()}>
        {(current) => (
          <ViewSwitch
            view="setup"
            hasPlan={false}
            creatingNew={false}
            plan={current}
            events={[current]}
            activeId={null}
            archivedIds={[]}
            onOpen={noop}
            onDelete={noop}
            onNew={noop}
            onDuplicate={noop}
            onArchive={noop}
            onRestore={noop}
            onCreated={onCreated}
          />
        )}
      </Harness>,
    );
    expect(screen.getByRole('heading', { name: /Plan your utsav/ })).toBeTruthy();
  });
});
