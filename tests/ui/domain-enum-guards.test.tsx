/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { parseOccasion } from '../../src/engine/create';
import {
  BOOKING_STATUSES,
  DIETARY_TAGS,
  OCCASIONS,
  PAYMENT_KINDS,
  RSVPS,
} from '../../src/engine/enums';
import type { Plan } from '../../src/engine/types';
import { GuestEditRow, GuestRow } from '../../src/ui/views/guests/GuestRows';
import { readDietary } from '../../src/ui/views/guests/shared';
import { parseEnum } from '../../src/ui/views/form';
import { fireEventSubmit } from './harness';
import { IdeasSection } from '../../src/ui/views/assistant/IdeasSection';
import { SetupView } from '../../src/ui/views/SetupView';
import { AddInstalmentForm } from '../../src/ui/views/vendors/AddInstalmentForm';
import { VendorCard } from '../../src/ui/views/vendors/VendorCard';
import { VendorsView } from '../../src/ui/views/vendors/VendorsView';
import { Harness } from './harness';
import { makePlan, run } from '../helpers';

/**
 * Finding 1 regression: user-controlled form values (selects, checkboxes) used to be
 * forced into domain enums with unchecked `as` assertions. Every such site now proves the
 * value against the runtime enum before it is typed, and an invalid value can no longer
 * reach the plan or a saved record. These tests pin the guards AND the tampered-value
 * behaviour (unreachable through the real UI, reachable through a tampered DOM).
 */

const noop = (): void => undefined;

describe('parseEnum (shared form guard)', () => {
  it('accepts exactly the allowed domain values and rejects everything else', () => {
    for (const status of BOOKING_STATUSES) {
      expect(parseEnum(status, BOOKING_STATUSES)).toBe(status);
    }
    expect(parseEnum('bogus', BOOKING_STATUSES)).toBeNull();
    expect(parseEnum('', BOOKING_STATUSES)).toBeNull();
    for (const kind of PAYMENT_KINDS) {
      expect(parseEnum(kind, PAYMENT_KINDS)).toBe(kind);
    }
    expect(parseEnum('advance ', PAYMENT_KINDS)).toBeNull(); // no trimming, exact match
    expect(parseEnum('yes', RSVPS)).toBe('yes');
    expect(parseEnum('maybe', RSVPS)).toBeNull();
    for (const occasion of OCCASIONS) {
      expect(parseEnum(occasion, OCCASIONS)).toBe(occasion);
    }
    expect(parseEnum('vegan', DIETARY_TAGS)).toBe('vegan');
    expect(parseEnum('meat', DIETARY_TAGS)).toBeNull();
  });
});

describe('parseOccasion (engine create-path gate)', () => {
  it('accepts every occasion and keeps the exact create-path rejection contract', () => {
    for (const occasion of OCCASIONS) {
      expect(parseOccasion(occasion)).toEqual({ ok: true, value: occasion });
    }
    const rejected = parseOccasion('housewarming');
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('INVALID_OCCASION');
      expect(rejected.error.message).toBe(
        'Choose one of: wedding, birthday, community, milestone.',
      );
      expect(rejected.error.field).toBe('occasion');
    }
    expect(parseOccasion(42).ok).toBe(false);
  });
});

describe('readDietary (checkbox values are user input)', () => {
  it('keeps real dietary tags in order and drops foreign values and File entries', () => {
    const data = new FormData();
    data.append('g1-dietary', 'vegan');
    data.append('g1-dietary', 'inject-me');
    data.append('g1-dietary', new File([], 'x'));
    data.append('g1-dietary', 'jain');
    expect(readDietary(data, 'g1')).toEqual(['vegan', 'jain']);
  });
});

describe('tampered form values never reach the plan (Finding 1)', () => {
  it('inline RSVP select: invalid value leaves the guest untouched, valid value still works', () => {
    const seed = run(makePlan(), {
      type: 'guest/add',
      id: 'g1',
      name: 'Meera',
      rsvp: 'yes',
      plusOnes: 0,
      dietary: [],
      group: 'Family',
    });
    let current: Plan = seed;
    render(
      <Harness seed={seed}>
        {(plan) => {
          current = plan;
          const guest = plan.guests[0];
          return guest === undefined ? null : <GuestRow guest={guest} onEdit={noop} />;
        }}
      </Harness>,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('RSVP for Meera');
    fireEvent.change(select, { target: { value: 'maybe' } });
    expect(current.guests[0]?.rsvp).toBe('yes'); // unchanged — no corrupting state
    fireEvent.change(select, { target: { value: 'no' } });
    expect(current.guests[0]?.rsvp).toBe('no'); // valid input behaves exactly as before
  });

  it('vendor status select: invalid value shows the engine rejection and keeps the status', () => {
    const seed = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: makePlan().categories[0]?.id ?? 'c1',
      name: 'Sharma Caterers',
      contactNote: '',
      status: 'not_started',
      committedMinor: null,
    });
    let current: Plan = seed;
    render(
      <Harness seed={seed}>
        {(plan) => {
          current = plan;
          const vendor = plan.vendors[0];
          return vendor === undefined ? null : <VendorCard plan={plan} vendor={vendor} />;
        }}
      </Harness>,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Booking status');
    fireEvent.change(select, { target: { value: 'bogus' } });
    expect(
      screen.getByText(
        'Booking status must be one of: not_started, contacted, quoted, booked, cancelled.',
      ),
    ).toBeInTheDocument();
    expect(current.vendors[0]?.status).toBe('not_started');
    fireEvent.change(select, { target: { value: 'contacted' } });
    expect(current.vendors[0]?.status).toBe('contacted');
    expect(screen.getByText('Status updated.')).toBeInTheDocument();
  });

  it('setup occasion select: an invalid option cannot enter the event state', () => {
    render(
      <Harness seed={makePlan()}>{(plan) => <SetupView plan={plan} onCreated={noop} />}</Harness>,
    );
    const select = screen.getByLabelText<HTMLSelectElement>('Occasion');
    expect(select.value).toBe('wedding');
    fireEvent.change(select, { target: { value: 'housewarming' } });
    expect(select.value).toBe('wedding'); // controlled state rejected the foreign value
    fireEvent.change(select, { target: { value: 'birthday' } });
    expect(select.value).toBe('birthday'); // valid input behaves exactly as before
  });

  it('assistant preference selects: an invalid value cannot poison the saved record', () => {
    render(<Harness seed={makePlan()}>{(plan) => <IdeasSection plan={plan} />}</Harness>);
    const formality = screen.getByLabelText<HTMLSelectElement>('Formality');
    fireEvent.change(formality, { target: { value: 'shabby-chic' } });
    expect(formality.value).toBe(''); // stays "Not set" — nothing invalid was saved
    fireEvent.change(formality, { target: { value: 'formal' } });
    expect(formality.value).toBe('formal'); // valid input behaves exactly as before
    const tier = screen.getByLabelText<HTMLSelectElement>('Budget tier');
    fireEvent.change(tier, { target: { value: 'deluxe' } });
    expect(tier.value).toBe('');
    fireEvent.change(tier, { target: { value: 'premium' } });
    expect(tier.value).toBe('premium');
  });
  it('guest edit form: a tampered RSVP keeps the form open and the guest untouched', () => {
    const seed = run(makePlan(), {
      type: 'guest/add',
      id: 'g1',
      name: 'Meera',
      rsvp: 'yes',
      plusOnes: 0,
      dietary: [],
      group: 'Family',
    });
    let current: Plan = seed;
    let done = false;
    render(
      <Harness seed={seed}>
        {(plan) => {
          current = plan;
          const guest = plan.guests[0];
          return guest === undefined ? null : (
            <GuestEditRow guest={guest} onDone={() => (done = true)} />
          );
        }}
      </Harness>,
    );
    fireEvent.change(screen.getByLabelText('RSVP'), { target: { value: 'maybe' } });
    fireEventSubmit(screen.getByLabelText('Name'));
    expect(done).toBe(false); // the form stays open, exactly as the engine rejection did
    expect(current.guests[0]?.rsvp).toBe('yes'); // the guest is untouched
    // The valid-submit path of this form is exercised by the dietary and core-workflow
    // suites; the inline RSVP test above proves the valid guard path.
  });

  it('add-vendor form: a tampered status surfaces the engine rejection and adds nothing', async () => {
    const user = userEvent.setup();
    let current: Plan = makePlan();
    render(
      <Harness seed={makePlan()}>
        {(plan) => {
          current = plan;
          return <VendorsView plan={plan} />;
        }}
      </Harness>,
    );
    await user.type(screen.getByLabelText('Vendor name'), 'Sharma Caterers');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'bogus' } });
    await user.click(screen.getByRole('button', { name: 'Add vendor' }));
    expect(
      screen.getByText(
        'Booking status must be one of: not_started, contacted, quoted, booked, cancelled.',
      ),
    ).toBeInTheDocument();
    expect(current.vendors).toHaveLength(0);
  });

  it('payment-kind select: a foreign value cannot enter the instalment form state', () => {
    const seed = run(makePlan(), {
      type: 'vendor/add',
      id: 'v1',
      categoryId: makePlan().categories[0]?.id ?? 'c1',
      name: 'Sharma Caterers',
      contactNote: '',
      status: 'booked',
      committedMinor: 1_000_000,
    });
    render(
      <Harness seed={seed}>
        {(plan) => {
          const vendor = plan.vendors[0];
          return vendor === undefined ? null : (
            <AddInstalmentForm plan={plan} vendor={vendor} onAdd={noop} />
          );
        }}
      </Harness>,
    );
    const kind = screen.getByLabelText<HTMLSelectElement>('Add payment');
    expect(kind.value).toBe('advance');
    fireEvent.change(kind, { target: { value: 'deposit' } });
    expect(kind.value).toBe('advance'); // unchanged
    fireEvent.change(kind, { target: { value: 'final' } });
    expect(kind.value).toBe('final'); // valid input behaves exactly as before
  });
});
