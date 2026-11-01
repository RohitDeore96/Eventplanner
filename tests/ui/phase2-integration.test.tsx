/** @vitest-environment jsdom */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { Harness, fireEventSubmit } from './harness';
import { EventsView } from '../../src/ui/views/EventsView';
import { RunSheetView } from '../../src/ui/views/RunSheetView';
import { VendorsView } from '../../src/ui/views/vendors';
import { ScenarioPanel } from '../../src/ui/views/ScenarioPanel';
import { makePlan, run } from '../helpers';
import { errorCode } from '../helpers';

/**
 * Phase 2 integration through the real App shell: duplicate, archive and restore keep the
 * workspace consistent; the scenario, run sheet and vendor surfaces behave through the
 * store. Storage is read directly, like a reload would.
 */

function seedWorkspace(): void {
  const a = makePlan({ id: 'ev1', name: 'Asha & Dev wedding' });
  const b = makePlan({ id: 'ev2', name: 'Diwali party' });
  localStorage.setItem(
    'utsav.plans.v1',
    JSON.stringify({
      schemaVersion: 3,
      savedAtISO: '2026-10-30T00:00:00.000Z',
      activeId: 'ev1',
      archivedIds: [],
      plans: [a, b],
    }),
  );
}

function stored(): {
  activeId: string | null;
  archivedIds: string[];
  plans: { id: string; name: string }[];
} {
  const raw = localStorage.getItem('utsav.plans.v1');
  if (raw === null) throw new Error('nothing stored');
  const parsed: unknown = JSON.parse(raw);
  const record = parsed as {
    activeId: string | null;
    archivedIds: string[];
    plans: { id: string; name: string }[];
  };
  return record;
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (row === null) throw new Error(`row for ${name} missing`);
  return row;
}

afterEach(() => {
  localStorage.clear();
});

describe('duplicate / archive / restore through the App (M13)', () => {
  it('duplicates an event under a fresh id without changing the active one', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    await user.click(within(rowFor('Diwali party')).getByRole('button', { name: 'Duplicate' }));
    await waitFor(() => {
      expect(stored().plans).toHaveLength(3);
    });
    expect(stored().activeId).toBe('ev1');
    const copy = stored().plans.find((p) => p.name === 'Copy of Diwali party');
    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe('ev2');
    expect(screen.getByText(/Created “Copy of Diwali party”/)).toBeInTheDocument();
  });

  it('archives a non-active event and restores it, keeping data untouched', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    await user.click(within(rowFor('Diwali party')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => {
      expect(stored().archivedIds).toEqual(['ev2']);
    });
    // The archived row moves to the Archived section and offers Restore.
    const archivedTitle = screen.getByText('Diwali party', { selector: 'strong' });
    expect(archivedTitle).toBeInTheDocument();
    expect(
      within(archivedTitle.closest('li') ?? archivedTitle).getByText('archived'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(stored().archivedIds).toEqual([]);
    });
    expect(stored().plans).toHaveLength(2);
  });

  it('archiving the active event moves the active marker to a surviving event', async () => {
    seedWorkspace();
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    await user.click(within(rowFor('Asha & Dev wedding')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => {
      expect(stored().archivedIds).toEqual(['ev1']);
    });
    expect(stored().activeId).toBe('ev2');
  });

  it('deleting an event also drops its quotations and preferences (no dead sidecars)', async () => {
    seedWorkspace();
    localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: [
          {
            id: 'q1',
            planId: 'ev2',
            categoryId: 'c',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            status: 'review',
            validityDate: null,
            note: '',
            fields: {
              vendorName: null,
              category: null,
              totalPriceMinor: null,
              pricePerPlateMinor: null,
              guestMinimum: null,
              overtimeFeePerHourMinor: null,
              taxIncluded: null,
              advancePercent: null,
              cancellationPolicy: null,
              inclusions: [],
              exclusions: [],
            },
          },
        ],
      }),
    );
    localStorage.setItem(
      'utsav.prefs.v1',
      JSON.stringify({
        schemaVersion: 1,
        prefs: [
          {
            planId: 'ev2',
            vibe: 'loud',
            formality: '',
            budgetTier: '',
            mustHaves: '',
            priorities: '',
          },
        ],
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'All events' }));
    await user.click(within(rowFor('Diwali party')).getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Really delete “Diwali party”/ }));
    await waitFor(() => {
      expect(stored().plans).toHaveLength(1);
    });
    const quotes: unknown = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}');
    expect((quotes as { quotes?: unknown[] }).quotes ?? []).toHaveLength(0);
    const prefs: unknown = JSON.parse(localStorage.getItem('utsav.prefs.v1') ?? '{}');
    expect((prefs as { prefs?: unknown[] }).prefs ?? []).toHaveLength(0);
  });
});

describe('custom scenario preview and apply (M12 UI)', () => {
  it('previews the family assumptions and applies them as one undo step', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    const guests = screen.getByLabelText('Guests');
    await user.clear(guests);
    await user.type(guests, '200');
    await user.click(screen.getByRole('button', { name: 'Preview my scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Guest target: 120 → 200/)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Apply my scenario' }));
    await waitFor(() => {
      expect(screen.getByText(/Scenario applied as one undo step/)).toBeInTheDocument();
    });
  });

  it('rejects impossible assumptions with a real message', async () => {
    const user = userEvent.setup();
    const plan = makePlan();
    render(<Harness seed={plan}>{(current) => <ScenarioPanel plan={current} />}</Harness>);
    const guests = screen.getByLabelText('Guests');
    await user.clear(guests);
    await user.type(guests, '0');
    await user.click(screen.getByRole('button', { name: 'Preview my scenario' }));
    expect(screen.getByText(/Enter a whole guest count/)).toBeInTheDocument();
  });
});

describe('run sheet edit and remove (M7 UI)', () => {
  const seededPlan = (): ReturnType<typeof makePlan> =>
    run(
      makePlan(),
      {
        type: 'runsheet/add',
        id: 'r1',
        title: 'Venue setup',
        dateISO: '2027-03-15',
        startTime: '09:00',
        endTime: '11:00',
        ownerId: null,
        location: 'Lawn',
        note: '',
      },
      {
        type: 'runsheet/add',
        id: 'r2',
        title: 'Sound check',
        dateISO: '2027-03-15',
        startTime: '08:00',
        endTime: '08:45',
        ownerId: null,
        location: 'Stage',
        note: '',
      },
    );

  it('edits an entry through the engine and shows the updated time', async () => {
    const user = userEvent.setup();
    const plan = seededPlan();
    render(<Harness seed={plan}>{(current) => <RunSheetView plan={current} />}</Harness>);
    const editButtons = screen.getAllByRole('button', { name: 'Edit' });
    const firstEdit = editButtons[0];
    if (firstEdit === undefined) throw new Error('no Edit button');
    const editRow = firstEdit.closest('tr');
    if (editRow === null) throw new Error('no entry row');
    const tbody = firstEdit.closest('tbody');
    if (tbody === null) throw new Error('no table body');
    await user.click(firstEdit);
    // The edit form replaces one row inside the same table body; scope lookups to it.
    const start = within(tbody).getByLabelText('Start');
    await user.clear(start);
    await user.type(start, '10:30');
    const end = within(tbody).getByLabelText('End');
    await user.clear(end);
    await user.type(end, '11:30');
    fireEventSubmit(start);
    await waitFor(() => {
      expect(screen.getByText(/10:30–11:30/)).toBeInTheDocument();
    });
  });

  it('removes an entry after the explicit confirmation', async () => {
    const user = userEvent.setup();
    const plan = seededPlan();
    render(<Harness seed={plan}>{(current) => <RunSheetView plan={current} />}</Harness>);
    const removeButtons = screen.getAllByRole('button', { name: 'Remove' });
    const firstRemove = removeButtons[0];
    if (firstRemove === undefined) throw new Error('no Remove button');
    await user.click(firstRemove);
    await user.click(screen.getByRole('button', { name: 'Really remove' }));
    await waitFor(() => {
      expect(screen.queryByText('Sound check')).toBeNull();
    });
    expect(screen.getByText('Venue setup')).toBeInTheDocument();
    expect(screen.getByText('Activity removed.')).toBeInTheDocument();
  });

  it('rejects a bad time range with the engine message', () => {
    const plan = seededPlan();
    expect(
      errorCode(plan, {
        type: 'runsheet/update',
        id: 'r1',
        startTime: '12:00',
      }),
    ).toBe('TIME_BACKWARDS');
    expect(
      errorCode(plan, {
        type: 'runsheet/update',
        id: 'r1',
        ownerId: 'ghost',
      }),
    ).toBe('VENDOR_NOT_FOUND');
  });
});

describe('events view controls (M13 UI)', () => {
  it('wires duplicate, archive and restore to the callbacks', async () => {
    let duplicated = '';
    let archived = '';
    let restored = '';
    const user = userEvent.setup();
    render(
      <EventsView
        events={[makePlan({ id: 'ev1', name: 'A' }), makePlan({ id: 'ev2', name: 'B' })]}
        activeId="ev1"
        archivedIds={['ev2']}
        onOpen={() => undefined}
        onDelete={() => undefined}
        onNew={() => undefined}
        onDuplicate={(id) => {
          duplicated = id;
        }}
        onArchive={(id) => {
          archived = id;
        }}
        onRestore={(id) => {
          restored = id;
        }}
        canCreate
      />,
    );
    await user.click(within(rowFor('B')).getByRole('button', { name: 'Restore' }));
    expect(restored).toBe('ev2');
    await user.click(within(rowFor('A')).getByRole('button', { name: 'Duplicate' }));
    expect(duplicated).toBe('ev1');
    await user.click(within(rowFor('A')).getByRole('button', { name: 'Archive' }));
    expect(archived).toBe('ev1');
  });
});

describe('vendor editing surface (M5 UI)', () => {
  const vendorPlan = (): ReturnType<typeof makePlan> =>
    run(
      makePlan(),
      {
        type: 'vendor/add',
        id: 'v1',
        categoryId: makePlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
        name: 'Annapurna Caterers',
        contactNote: '',
        contactPerson: 'Sharma uncle',
        phone: '',
        email: '',
        status: 'contacted',
        committedMinor: null,
      },
      {
        type: 'vendor/setSchedule',
        id: 'v1',
        schedule: [{ id: 'i-adv', kind: 'advance', dueISO: '2027-01-01', amountMinor: 4_000_000 }],
      },
    );

  it('search filters the vendor list by name and person', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(current) => <VendorsView plan={current} />}</Harness>);
    await user.type(screen.getByLabelText('Search vendors'), 'sharma');
    expect(screen.getByText('Annapurna Caterers')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search vendors'));
    await user.type(screen.getByLabelText('Search vendors'), 'nonexistent');
    expect(screen.getByText(/No vendors match/)).toBeInTheDocument();
  });

  it('saves edited contact details through the engine', async () => {
    const user = userEvent.setup();
    render(<Harness seed={vendorPlan()}>{(current) => <VendorsView plan={current} />}</Harness>);
    await user.click(screen.getByRole('button', { name: 'Edit details' }));
    const phone = screen.getByLabelText('Phone');
    await user.type(phone, '98765 43210');
    fireEventSubmit(phone);
    await waitFor(() => {
      expect(screen.getByText(/98765 43210/)).toBeInTheDocument();
    });
  });

  it('removes an unpaid instalment and blocks removal of a paid one', () => {
    const withPayment = run(vendorPlan(), {
      type: 'expense/add',
      id: 'x1',
      categoryId: vendorPlan().categories.find((c) => c.key === 'catering')?.id ?? 'c',
      vendorId: 'v1',
      instalmentId: 'i-adv',
      dateISO: '2026-12-20',
      amountMinor: 4_000_000,
      note: 'advance paid',
    });
    render(<Harness seed={withPayment}>{(current) => <VendorsView plan={current} />}</Harness>);
    // The advance is settled, so no remove affordance is offered.
    expect(screen.queryByRole('button', { name: 'Remove from schedule' })).toBeNull();
    // The engine also refuses a schedule edit that would orphan a paid instalment.
    expect(errorCode(withPayment, { type: 'vendor/setSchedule', id: 'v1', schedule: [] })).toBe(
      'INSTALMENT_ALREADY_PAID',
    );
  });

  it('keeps a quotation validity date and note beside the quote', async () => {
    const user = userEvent.setup();
    const plan = vendorPlan();
    localStorage.setItem(
      'utsav.quotes.v1',
      JSON.stringify({
        schemaVersion: 2,
        quotes: [
          {
            id: 'q9',
            planId: plan.id,
            categoryId: plan.categories.find((c) => c.key === 'catering')?.id ?? 'c',
            savedAtISO: '2026-10-30T00:00:00.000Z',
            status: 'review',
            validityDate: null,
            note: '',
            fields: {
              vendorName: 'Sharma Caterers',
              category: null,
              totalPriceMinor: 2_500_000,
              pricePerPlateMinor: null,
              guestMinimum: null,
              overtimeFeePerHourMinor: null,
              taxIncluded: null,
              advancePercent: null,
              cancellationPolicy: null,
              inclusions: [],
              exclusions: [],
            },
          },
        ],
      }),
    );
    render(<Harness seed={plan}>{(current) => <VendorsView plan={current} />}</Harness>);
    const validity = screen.getByLabelText('Valid until');
    await user.type(validity, '2026-12-31');
    const note = screen.getByLabelText('Notes');
    await user.type(note, 'calls only after 6pm');
    await waitFor(() => {
      const stored: unknown = JSON.parse(localStorage.getItem('utsav.quotes.v1') ?? '{}');
      const quotes =
        (stored as { quotes?: { validityDate?: string; note?: string }[] }).quotes ?? [];
      expect(quotes[0]?.validityDate).toBe('2026-12-31');
      expect(quotes[0]?.note).toContain('calls only after 6pm');
    });
    localStorage.clear();
  });
});
