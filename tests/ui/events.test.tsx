/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { makePlan } from '../helpers';
import { EventsView } from '../../src/ui/views/EventsView';

/**
 * R8 UI acceptance: every saved event is listed with its own basics, the active one is
 * marked, switching calls back with the id, and deletion demands a second click.
 */

describe('events view (R8 UI)', () => {
  it('lists events with the active badge and opens on click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const a = makePlan({ id: 'ev1', name: 'Asha & Dev wedding' });
    const b = makePlan({ id: 'ev2', name: 'Diwali party' });
    render(
      <EventsView
        events={[a, b]}
        activeId="ev1"
        onOpen={onOpen}
        onDelete={() => undefined}
        onNew={() => undefined}
        canCreate
      />,
    );
    expect(screen.getByText('Asha & Dev wedding')).toBeInTheDocument();
    expect(screen.getByText('Diwali party')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(onOpen).toHaveBeenCalledWith('ev2');
  });

  it('deletion needs an explicit second confirmation', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <EventsView
        events={[makePlan({ id: 'ev1', name: 'Precious plan' })]}
        activeId="ev1"
        onOpen={() => undefined}
        onDelete={onDelete}
        onNew={() => undefined}
        canCreate
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Really delete “Precious plan”/ }));
    expect(onDelete).toHaveBeenCalledWith('ev1');
  });

  it('offers a way back and an honest empty state', async () => {
    const user = userEvent.setup();
    render(
      <EventsView
        events={[]}
        activeId={null}
        onOpen={() => undefined}
        onDelete={() => undefined}
        onNew={() => undefined}
        canCreate
      />,
    );
    expect(screen.getByText(/No events yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New event' }));
    expect(screen.getByRole('button', { name: 'New event' })).toBeEnabled();
  });

  it('disables creating past the event cap with a reason', () => {
    render(
      <EventsView
        events={[makePlan()]}
        activeId={null}
        onOpen={() => undefined}
        onDelete={() => undefined}
        onNew={() => undefined}
        canCreate={false}
      />,
    );
    expect(screen.getByRole('button', { name: 'New event' })).toBeDisabled();
    expect(screen.getByText(/up to 12 events/)).toBeInTheDocument();
  });
});
