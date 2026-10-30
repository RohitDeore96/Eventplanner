import { describe, expect, it } from 'vitest';
import {
  capEntries,
  describeAction,
  makeEntry,
  markRedone,
  markReverted,
} from '../../src/state/activity';
import { catId, makePlan, TODAY } from '../helpers';
import type { PlanAction } from '../../src/engine/actions';

/** X9 label coverage: every action type produces a named, human-readable line. */
describe('activity labels', () => {
  const plan = makePlan();

  it('describes event updates field by field', () => {
    expect(describeAction({ type: 'event/update', changes: { name: 'New name' } }, plan)).toContain(
      'renamed to “New name”',
    );
    expect(
      describeAction({ type: 'event/update', changes: { dateISO: '2027-04-01' } }, plan),
    ).toContain('date set to 2027-04-01');
    expect(describeAction({ type: 'event/update', changes: { guestTarget: 150 } }, plan)).toContain(
      'guest target 150',
    );
    expect(
      describeAction({ type: 'event/update', changes: { budgetMinor: 1_000 } }, plan),
    ).toContain('budget changed');
    expect(describeAction({ type: 'event/update', changes: { currency: 'USD' } }, plan)).toContain(
      'currency USD',
    );
    expect(describeAction({ type: 'event/update', changes: {} }, plan)).toBe('Event updated');
  });

  it('describes budget moves with both category names', () => {
    const action: PlanAction = {
      type: 'budget/move',
      fromId: catId(plan, 'venue'),
      toId: catId(plan, 'catering'),
      amountMinor: 1_000_000,
    };
    expect(describeAction(action, plan)).toContain('from “Venue” to “Catering”');
  });

  it('describes category lifecycle including renames', () => {
    const id = catId(plan, 'venue');
    expect(
      describeAction({ type: 'category/add', id: 'c9', name: 'Mehendi', plannedMinor: 5 }, plan),
    ).toContain('Mehendi');
    expect(describeAction({ type: 'category/update', id, plannedMinor: 9_000 }, plan)).toMatch(
      /planned at/,
    );
    expect(describeAction({ type: 'category/update', id, name: 'Banquet' }, plan)).toContain(
      'renamed',
    );
    expect(describeAction({ type: 'category/update', id }, plan)).toContain('updated');
    expect(describeAction({ type: 'category/delete', id }, plan)).toContain('removed');
  });

  it('describes task lifecycle', () => {
    expect(
      describeAction(
        {
          type: 'task/add',
          id: 't1',
          title: 'Book mandap',
          dueISO: '2027-01-01',
          dependsOn: [],
          assignee: null,
        },
        plan,
      ),
    ).toContain('Book mandap');
    expect(describeAction({ type: 'task/update', id: 't1', done: true }, plan)).toContain(
      'marked done',
    );
    expect(describeAction({ type: 'task/update', id: 't1', dueISO: '2027-02-02' }, plan)).toContain(
      'moved to',
    );
    expect(describeAction({ type: 'task/update', id: 't1', title: 'Book stage' }, plan)).toContain(
      'renamed',
    );
    expect(describeAction({ type: 'task/update', id: 't1', assignee: 'Asha' }, plan)).toContain(
      'assigned',
    );
    expect(describeAction({ type: 'task/update', id: 't1' }, plan)).toContain('updated');
    expect(describeAction({ type: 'task/delete', id: 't1' }, plan)).toContain('removed');
    expect(
      describeAction({ type: 'task/setDependencies', id: 't1', dependsOn: ['x', 'y'] }, plan),
    ).toContain('2 prerequisite(s)');
    expect(describeAction({ type: 'task/reorder', id: 't1', toIndex: 2 }, plan)).toContain(
      'reordered',
    );
    expect(describeAction({ type: 'task/delay', id: 't1', days: 3 }, plan)).toContain('3 day(s)');
  });

  it('describes vendor lifecycle', () => {
    expect(
      describeAction(
        {
          type: 'vendor/add',
          id: 'v9',
          categoryId: catId(plan, 'venue'),
          name: 'Grand Hall',
          contactNote: '',
          status: 'booked',
          committedMinor: null,
        },
        plan,
      ),
    ).toContain('Grand Hall');
    expect(describeAction({ type: 'vendor/update', id: 'v1', status: 'booked' }, plan)).toContain(
      'marked booked',
    );
    expect(
      describeAction({ type: 'vendor/update', id: 'v1', committedMinor: 5_000 }, plan),
    ).toMatch(/agreed price/);
    expect(
      describeAction({ type: 'vendor/update', id: 'v1', committedMinor: null }, plan),
    ).toContain('updated');
    expect(describeAction({ type: 'vendor/delete', id: 'v1' }, plan)).toContain('removed');
    expect(
      describeAction(
        {
          type: 'vendor/setSchedule',
          id: 'v1',
          schedule: [{ id: 'i1', kind: 'advance', dueISO: TODAY, amountMinor: 100 }],
        },
        plan,
      ),
    ).toContain('1 instalment(s)');
  });

  it('describes expenses, with the category name when there is no note', () => {
    expect(
      describeAction(
        {
          type: 'expense/add',
          id: 'e1',
          categoryId: catId(plan, 'venue'),
          vendorId: null,
          instalmentId: null,
          dateISO: TODAY,
          amountMinor: 500,
          note: '',
        },
        plan,
      ),
    ).toMatch(/recorded — .+/);
    expect(
      describeAction({ type: 'expense/update', id: 'e1', note: 'balloon pump' }, plan),
    ).toContain('balloon pump');
    expect(describeAction({ type: 'expense/update', id: 'e1' }, plan)).toContain('updated');
    expect(describeAction({ type: 'expense/delete', id: 'e1' }, plan)).toContain('removed');
  });

  it('describes guest lifecycle with plus-ones', () => {
    expect(
      describeAction(
        {
          type: 'guest/add',
          id: 'g9',
          name: 'Ravi',
          rsvp: 'pending',
          plusOnes: 2,
          dietary: [],
          group: '',
        },
        plan,
      ),
    ).toContain('+2');
    expect(describeAction({ type: 'guest/update', id: 'g1', rsvp: 'no' }, plan)).toContain(
      'RSVP no',
    );
    expect(describeAction({ type: 'guest/update', id: 'g1', plusOnes: 3 }, plan)).toContain(
      'plus-ones set to 3',
    );
    expect(describeAction({ type: 'guest/update', id: 'g1', group: 'Friends' }, plan)).toContain(
      'updated',
    );
    expect(describeAction({ type: 'guest/delete', id: 'g1' }, plan)).toContain('removed');
  });

  it('caps the log and flips the newest matching entry on undo/redo', () => {
    const entries = [1, 2, 3].map((n) => makeEntry(`change ${n}`, 'single', TODAY));
    expect(capEntries(entries, 2)).toHaveLength(2);
    expect(capEntries(entries, 5)).toHaveLength(3);

    const flipped = markReverted(entries);
    expect(flipped[2]?.reverted).toBe(true);
    expect(flipped[0]?.reverted).toBe(false);
    const redone = markRedone(flipped);
    expect(redone[2]?.reverted).toBe(false);
    // Nothing to flip is a no-op.
    expect(markReverted([])).toEqual([]);
    expect(markRedone(entries)).toEqual(entries);
  });
});
