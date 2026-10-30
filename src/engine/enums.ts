import type { BookingStatus, DietaryTag, Occasion, Rsvp } from './types';

/**
 * Runtime enum values, kept beside the types they mirror. Reducers use them to reject
 * unknown strings from untrusted input (AI patches, storage, imports) without throwing.
 */
export const OCCASIONS: readonly Occasion[] = ['wedding', 'birthday', 'community'];
export const RSVPS: readonly Rsvp[] = ['yes', 'no', 'pending'];
export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'not_started',
  'contacted',
  'quoted',
  'booked',
  'cancelled',
];
export const DIETARY_TAGS: readonly DietaryTag[] = [
  'vegetarian',
  'vegan',
  'halal',
  'kosher',
  'gluten_free',
  'nut_allergy',
  'jain',
];
