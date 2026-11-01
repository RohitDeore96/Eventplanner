/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/ui/App';
import { clearSavedPlan, loadWorkspace, saveWorkspace } from '../../src/state/persistence';
import { makePlan, run } from '../helpers';
import { Harness, fireEventSubmit } from './harness';
import { BudgetView } from '../../src/ui/views/budget';
import { ScenarioPanel } from '../../src/ui/views/ScenarioPanel';

/**
 * Final Phase 2 coverage: the App shell (demo, exports, undo/redo, recovery, save-failure
 * notice), persistence failure paths, the allocation Set flow and the remaining scenario
 * previews. Storage is read directly, like a reload would.
 */

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('App shell (M10/M14)', () => {
  it('loads the demo event from an empty browser and every tab renders', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Load demo event' }));
    // The button saves the demo plan and then reloads the page (a no-op in jsdom), so the
    // observable effect is the persisted workspace.
    await waitFor(() => {
      const raw = localStorage.getItem('utsav.plans.v1') ?? '';
      expect(raw).toContain('Asha & Dev wedding');
      expect(raw).toContain('runSheet');
    });
    // The demo carries vendors, run-sheet entries, guests and an activity log.
    for (const tab of ['Run sheet', 'Vendors', 'Payments', 'Activity', 'Assistant']) {
      await user.click(screen.getByRole('tab', { name: tab }));
      expect(screen.getByRole('tabpanel')).not.toBeEmptyDOMElement();
    }
  });

  it('exports JSON and CSV from the header', async () => {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 3,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: 'ev1',
        archivedIds: [],
        plans: [makePlan({ id: 'ev1' })],
      }),
    );
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {
      return undefined;
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      return undefined;
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(urlSpy).toHaveBeenCalledTimes(2);
    expect(revokeSpy).toHaveBeenCalledTimes(2);
    expect(clickSpy).toHaveBeenCalledTimes(2);
  });

  it('undo and redo buttons disable at the ends of the history', async () => {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 3,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: 'ev1',
        archivedIds: [],
        plans: [makePlan({ id: 'ev1' })],
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    // A change enables Undo; pressing it returns to the fresh state and enables Redo.
    await user.click(screen.getByRole('tab', { name: 'Run sheet' }));
    await user.type(screen.getByLabelText('Activity'), 'Rehearsal dinner');
    fireEventSubmit(screen.getByLabelText('Activity'));
    await waitFor(() => {
      expect(undo).toBeEnabled();
    });
    await user.click(undo);
    await waitFor(() => {
      expect(redo).toBeEnabled();
    });
  });

  it('shows the recovery card with a downloadable copy when storage is corrupt', async () => {
    localStorage.setItem('utsav.plans.v1', '{broken json');
    const urlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock');
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {
      return undefined;
    });
    render(<App />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Download a copy' }));
    expect(urlSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => {
      expect(localStorage.getItem('utsav.plans.v1')).toBeNull();
    });
  });

  it('warns visibly when the browser refuses an autosave', async () => {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 3,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: 'ev1',
        archivedIds: [],
        plans: [makePlan({ id: 'ev1' })],
      }),
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Run sheet' }));
    await user.type(screen.getByLabelText('Activity'), 'Sangeet night');
    fireEventSubmit(screen.getByLabelText('Activity'));
    await waitFor(() => {
      expect(screen.getByText(/not saved|refused to save/i)).toBeInTheDocument();
    });
  });
});

describe('persistence failure paths (M13.3)', () => {
  it('reports a refused write instead of pretending it succeeded', () => {
    const throwing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    const status = saveWorkspace([makePlan()], 'ev1', [], throwing);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('refused to save');
  });

  it('rejects an oversized workspace and a too-many-events write', () => {
    const memory = {
      getItem: () => null,
      setItem: (key: string, value: string) => {
        memory[key] = value;
      },
      removeItem: () => undefined,
    } as unknown as Storage;
    const many = Array.from({ length: 13 }, (_, i) => makePlan({ id: `ev-${i}` }));
    const status = saveWorkspace(many.slice(0, 13), 'ev-0', [], memory);
    expect(status.ok).toBe(false);
    expect(status.reason).toContain('up to 12');
  });

  it('reports storage that refuses to be read instead of pretending it is empty', () => {
    // Stage-2 reliability: an inaccessible store used to come back as a plain empty
    // workspace; it must be distinguishable so the UI can say the family's events
    // could not be checked (they may still be in there).
    const throwing = {
      getItem: () => {
        throw new Error('private mode');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    } as unknown as Storage;
    const workspace = loadWorkspace(throwing);
    expect(workspace.plans).toHaveLength(0);
    expect(workspace.recovery?.reason).toBe('unavailable');
  });

  it('survives a browser that throws the moment window.localStorage is touched', () => {
    // Private-mode browsers can make the localStorage ACCESSOR itself throw; the
    // persistence layer resolves its default inside the try, so nothing escapes.
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(() => loadWorkspace()).not.toThrow();
      expect(loadWorkspace().recovery?.reason).toBe('unavailable');
      expect(() => {
        clearSavedPlan();
      }).not.toThrow();
      const status = saveWorkspace([makePlan({ id: 'ev1' })], 'ev1');
      expect(status.ok).toBe(false);
      expect(status.reason).toContain('refused');
    } finally {
      if (descriptor !== undefined) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });

  it('shows the storage-unavailable recovery card without a download offer', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      render(<App />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/storage is unavailable/)).toBeInTheDocument();
      // Nothing could be read, so there is no copy to download.
      expect(screen.queryByRole('button', { name: 'Download a copy' })).toBeNull();
    } finally {
      if (descriptor !== undefined) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });
});

/**
 * Stage-2 recovery journeys: the recovery card must stay truthful at every step —
 * "Start fresh" may only reload when the browser actually allowed the clear, a refused
 * clear is said out loud instead of looping the card forever, and "continue for this
 * session" runs the app on the persistence module's volatile store so the real (broken)
 * storage is never touched, let alone overwritten.
 */
describe('recovery journeys (stage-2)', () => {
  it('says so when the browser refuses to clear, keeps the data, and offers the session path', async () => {
    localStorage.setItem('utsav.plans.v1', '{corrupt');
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start fresh' }));
    // The refusal is stated; nothing was deleted; the session continuation appears.
    expect(
      screen.getByText(/refused to clear the saved data, so nothing was deleted/),
    ).toBeInTheDocument();
    expect(localStorage.getItem('utsav.plans.v1')).toBe('{corrupt');
    expect(screen.getByRole('button', { name: 'Continue for this session' })).toBeInTheDocument();
  });

  it('continue for this session: the app runs in memory and the real storage is never touched', async () => {
    // The session store is module state, so this journey runs on a fresh module graph;
    // the statically imported App (and its persistence) stay untouched for other tests.
    vi.resetModules();
    const [{ App: FreshApp }, p, session] = await Promise.all([
      import('../../src/ui/App'),
      import('../../src/state/persistence'),
      import('../../src/state/sessionStore'),
    ]);
    localStorage.setItem('utsav.plans.v1', '{still broken');
    // The browser allows reads but refuses to clear — the trapped state the old
    // "Start fresh" looped on forever.
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const user = userEvent.setup();
    render(<FreshApp />);
    expect(screen.getByText(/not readable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download a copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue for this session' })).toBeNull();
    // Start fresh cannot clear: the refusal is stated and the session path appears.
    await user.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(
      screen.getByText(/refused to clear the saved data, so nothing was deleted/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue for this session' }));
    // The card is gone, the session-only banner is up, and the stored bytes survived.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/changes last only for this session/)).toBeInTheDocument();
    expect(localStorage.getItem('utsav.plans.v1')).toBe('{still broken');
    expect(session.isSessionOnlyStorage()).toBe(true);
    // Planning keeps working: the demo event saves into the session store…
    await user.click(screen.getByRole('button', { name: 'Load demo event' }));
    await waitFor(() => {
      expect(p.loadWorkspace().plans).toHaveLength(1);
    });
    expect(p.loadWorkspace().plans[0]?.name).toContain('Asha & Dev wedding');
    // …while the real storage still holds exactly what it held before.
    expect(localStorage.getItem('utsav.plans.v1')).toBe('{still broken');
  });

  it('repeated reloads with inaccessible storage keep showing the honest card', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      const user = userEvent.setup();
      for (let reload = 0; reload < 2; reload += 1) {
        const { unmount } = render(<App />);
        expect(screen.getByText(/storage is unavailable/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Download a copy' })).toBeNull();
        // Start fresh cannot clear what it cannot read: the truthful fallback appears.
        await user.click(screen.getByRole('button', { name: 'Start fresh' }));
        expect(screen.getByText(/refused to clear the saved data/)).toBeInTheDocument();
        unmount();
      }
    } finally {
      if (descriptor !== undefined) Object.defineProperty(window, 'localStorage', descriptor);
      else delete (window as { localStorage?: unknown }).localStorage;
    }
  });
});

describe('allocation Set flow (M10.1 UI)', () => {
  it('sets a new allocation and rejects a malformed one with the honest message', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    const decor = plan.categories.find((c) => c.key === 'decor');
    render(<Harness seed={plan}>{(c) => <BudgetView plan={c} />}</Harness>);
    const input = screen.getByLabelText(`Allocation for ${decor?.name} in INR`);
    await user.type(input, 'abc');
    const decorRow = input.closest('tr');
    if (decorRow === null) throw new Error('no allocation row');
    await user.click(within(decorRow).getByRole('button', { name: 'Set' }));
    await waitFor(() => {
      expect(screen.getByText(/Enter the allocation in major units/)).toBeInTheDocument();
    });
    await user.clear(input);
    await user.type(input, '50000');
    await user.click(within(decorRow).getByRole('button', { name: 'Set' }));
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`${decor?.name} set to`))).toBeInTheDocument();
    });
  });
});

describe('remaining scenario previews (M12)', () => {
  it('previews guest growth with catering and per-head effects', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Guests \+20%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview: Guests \+20%/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Guest target:/)).toBeInTheDocument();
  });

  it('previews the date-closer scenario', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Event 14 days closer/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview:/)).toBeInTheDocument();
    });
  });

  it('previews and applies the catering increase', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Catering costs \+15%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Preview: Catering costs \+15%/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Apply this scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Scenario applied as one undo step/)).toBeInTheDocument();
    });
  });
});

describe('reset and deeper recovery paths (M5/M14)', () => {
  function seedOne(): void {
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({
        schemaVersion: 3,
        savedAtISO: '2026-10-30T00:00:00.000Z',
        activeId: 'ev1',
        archivedIds: [],
        plans: [makePlan({ id: 'ev1' })],
      }),
    );
  }

  it('reset demands confirmation and clears the workspace', async () => {
    seedOne();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Delete every saved event' }));
    await waitFor(() => {
      expect(localStorage.getItem('utsav.plans.v1')).toBeNull();
    });
  });

  it('reset can be cancelled and leaves storage alone', async () => {
    seedOne();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Keep my events' }));
    expect(localStorage.getItem('utsav.plans.v1')).not.toBeNull();
  });

  it('names too-large storage and newer versions in the recovery card', async () => {
    // too_large: over the 400 KB cap
    localStorage.setItem('utsav.plans.v1', 'x'.repeat(401_000));
    render(<App />);
    expect(screen.getByText(/too large to load/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start fresh' }));
    await waitFor(() => {
      expect(localStorage.getItem('utsav.plans.v1')).toBeNull();
    });
    // newer_version: written by a future Utsav
    localStorage.setItem(
      'utsav.plans.v1',
      JSON.stringify({ schemaVersion: 99, savedAtISO: 'x', activeId: null, plans: [] }),
    );
    render(<App />);
    expect(screen.getByText(/newer version of Utsav/)).toBeInTheDocument();
  });
});

describe('expense edit unassign (M6 UI)', () => {
  it('reassigns an expense back to direct spend in one edit', async () => {
    const user = userEvent.setup();
    const catering = makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c';
    const plan = run(
      makePlan(),
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: catering,
        name: 'Annapurna Caterers',
        contactNote: '',
        status: 'booked',
        committedMinor: 10_000_000,
      },
      {
        type: 'expense/add',
        id: 'x1',
        categoryId: catering,
        vendorId: 'v1',
        instalmentId: null,
        dateISO: '2026-12-20',
        amountMinor: 2_000_000,
        note: 'advance',
      },
    );
    render(<Harness seed={plan}>{(c) => <BudgetView plan={c} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const vendorSelect = screen.getByLabelText(/Vendor \(this expense's category/);
    await user.selectOptions(vendorSelect, '');
    fireEventSubmit(vendorSelect);
    await waitFor(() => {
      expect(screen.getByText('Expense updated.')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Direct spend').length).toBeGreaterThan(0);
  });
});

describe('scenario delta lines (M12)', () => {
  it('shows the budget and category lines for a budget cut', async () => {
    const user = userEvent.setup();
    render(<Harness seed={makePlan()}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Budget −15%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Budget: −₹/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Catering:/)).toBeInTheDocument();
  });

  it('shows the committed delta for a vendor price rise', async () => {
    const user = userEvent.setup();
    const catering = makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c';
    const plan = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: catering,
      name: 'Annapurna Caterers',
      contactNote: '',
      status: 'booked',
      committedMinor: 10_000_000,
    });
    render(<Harness seed={plan}>{(c) => <ScenarioPanel plan={c} />}</Harness>);
    await user.click(screen.getByRole('radio', { name: /Vendor prices \+10%/ }));
    await user.click(screen.getByRole('button', { name: 'Preview impact' }));
    await waitFor(() => {
      expect(screen.getByText(/Committed: \+₹/)).toBeInTheDocument();
    });
  });
});
