import { useState } from 'react';
import type { Vendor } from '../../../engine/types';
import { usePlan } from '../../../state/store';
import { text } from '../form';

/** Editable vendor details: name, contact person, phone, email, note (M5.1). */
export function VendorEditForm({
  vendor,
  onDone,
}: {
  vendor: Vendor;
  onDone: () => void;
}): React.ReactNode {
  const store = usePlan();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <form
      className="row"
      aria-label={`Edit details for ${vendor.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const outcome = store.apply({
          type: 'vendor/update',
          id: vendor.id,
          name: text(data, 'name'),
          contactPerson: text(data, 'person'),
          phone: text(data, 'phone'),
          email: text(data, 'email'),
          contactNote: text(data, 'note'),
        });
        setNotice(outcome.ok ? 'Details saved.' : (outcome.message ?? 'Details were not saved.'));
        if (outcome.ok) onDone();
      }}
    >
      <div>
        <label htmlFor={`${vendor.id}-ed-name`}>Vendor name</label>
        <input
          id={`${vendor.id}-ed-name`}
          name="name"
          defaultValue={vendor.name}
          required
          maxLength={80}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-person`}>Contact person</label>
        <input
          id={`${vendor.id}-ed-person`}
          name="person"
          defaultValue={vendor.contactPerson}
          maxLength={120}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-phone`}>Phone</label>
        <input
          id={`${vendor.id}-ed-phone`}
          name="phone"
          type="tel"
          defaultValue={vendor.phone}
          maxLength={40}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-email`}>Email</label>
        <input
          id={`${vendor.id}-ed-email`}
          name="email"
          type="email"
          defaultValue={vendor.email}
          maxLength={120}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-ed-note`}>Contact note</label>
        <input
          id={`${vendor.id}-ed-note`}
          name="note"
          defaultValue={vendor.contactNote}
          maxLength={500}
        />
      </div>
      <button type="submit" className="primary">
        Save details
      </button>
      {notice !== null && (
        <p className="muted" role="status">
          {notice}
        </p>
      )}
    </form>
  );
}
