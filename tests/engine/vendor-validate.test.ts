import { describe, expect, it } from 'vitest';
import {
  checkBooking,
  checkContactField,
  checkEmail,
  checkPhone,
  checkStatusInput,
  sameName,
} from '../../src/engine/reducers/vendorValidate';

/**
 * Direct guards for the vendor field validators (moved out of the vendors reducer):
 * booking/price coupling, closed-set status handling, contact caps and the light email
 * shape check. Error codes are part of the public contract the UI speaks.
 */

describe('vendor field validators', () => {
  it('requires an agreed price before a vendor can be booked', () => {
    expect(checkBooking('booked', null)).toMatchObject({ ok: false });
    expect(checkBooking('booked', 5_000_00)).toMatchObject({ ok: true });
    expect(checkBooking('quoted', null)).toMatchObject({ ok: true });
    const rejected = checkBooking('contacted', -1);
    expect(rejected.ok).toBe(false);
  });

  it('accepts only the closed booking statuses and normalises absent prices to null', () => {
    expect(checkStatusInput('booked', 5_000_00)).toMatchObject({
      ok: true,
      value: { status: 'booked', committedMinor: 5_000_00 },
    });
    expect(checkStatusInput('contacted', undefined)).toMatchObject({
      ok: true,
      value: { status: 'contacted', committedMinor: null },
    });
    expect(checkStatusInput('famous', null)).toMatchObject({ ok: false });
  });

  it('caps contact fields and trims them; absent values become empty strings', () => {
    expect(checkContactField(undefined, 'contactPerson', 'Contact person')).toMatchObject({
      ok: true,
      value: '',
    });
    expect(checkContactField('  Sharma ji  ', 'contactPerson', 'Contact person')).toMatchObject({
      ok: true,
      value: 'Sharma ji',
    });
    expect(checkContactField('x'.repeat(121), 'contactPerson', 'Contact person')).toMatchObject({
      ok: false,
    });
    expect(checkPhone('9876543210')).toMatchObject({ ok: true, value: '9876543210' });
    expect(checkPhone('9'.repeat(41))).toMatchObject({ ok: false });
  });

  it('applies the light email shape check without a full RFC parser', () => {
    expect(checkEmail('family@example.com')).toMatchObject({ ok: true });
    expect(checkEmail('not-an-email')).toMatchObject({ ok: false });
    expect(checkEmail('')).toMatchObject({ ok: true, value: '' });
  });

  it('compares vendor names case-insensitively on trimmed text', () => {
    expect(sameName(' Sharma Caterers ', 'sharma caterers')).toBe(true);
    expect(sameName('Sharma Caterers', 'Sharma Decorators')).toBe(false);
  });
});
