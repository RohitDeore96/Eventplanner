import type { DietaryTag, Rsvp } from '../../../engine/types';
import { DIETARY_TAGS } from '../../../engine/enums';
import { parseEnum } from '../form';

/** Shared guest-domain vocabulary and the dietary checkbox group used by every guest form. */

export const RSVP_OPTIONS: readonly { readonly value: Rsvp; readonly label: string }[] = [
  { value: 'yes', label: 'Coming' },
  { value: 'no', label: 'Not coming' },
  { value: 'pending', label: 'Waiting for reply' },
];

/** Human labels for the engine's dietary tags; shown as text, never colour alone. */
export const DIETARY_LABELS: Record<DietaryTag, string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  no_onion_garlic: 'No onion & garlic',
  gluten_free: 'Gluten-free',
  dairy_free: 'Dairy-free',
  nut_allergy: 'Nut allergy',
  halal: 'Halal',
  kosher: 'Kosher',
  other: 'Other restrictions',
};

export const ALLERGY_TAGS: readonly DietaryTag[] = ['nut_allergy', 'gluten_free', 'dairy_free'];

/** Shared checkbox group for dietary needs (multiple allowed per guest). */
export function DietaryPicker({
  guestId,
  selected,
  legend,
}: {
  guestId: string;
  selected: readonly DietaryTag[];
  legend: string;
}) {
  return (
    <fieldset className="dietary-picker">
      <legend>{legend}</legend>
      {DIETARY_TAGS.map((tag) => (
        <label key={tag} className="check">
          <input
            type="checkbox"
            name={`${guestId}-dietary`}
            value={tag}
            defaultChecked={selected.includes(tag)}
          />{' '}
          {DIETARY_LABELS[tag]}
        </label>
      ))}
    </fieldset>
  );
}

export function readDietary(formData: FormData, guestId: string): DietaryTag[] {
  // Checkbox values are user input: keep only real dietary tags (a File entry is never
  // one). The engine still validates the whole action afterwards (defence in depth).
  return formData.getAll(`${guestId}-dietary`).flatMap((value) => {
    const tag = typeof value === 'string' ? parseEnum(value, DIETARY_TAGS) : null;
    return tag === null ? [] : [tag];
  });
}
