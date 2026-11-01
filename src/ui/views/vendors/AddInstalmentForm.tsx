import { useState } from 'react';
import type { InstalmentInput } from '../../../engine/actions';
import { PAYMENT_KINDS } from '../../../engine/enums';
import { parseMajorAmount } from '../../../engine/money';
import type { PaymentKind, Plan, Vendor } from '../../../engine/types';
import { parseEnum } from '../form';
import { KIND_LABELS } from './shared';

export function AddInstalmentForm({
  plan,
  vendor,
  onAdd,
}: {
  plan: Plan;
  vendor: Vendor;
  onAdd: (instalment: InstalmentInput) => void;
}): React.ReactNode {
  // Controlled inputs: the values survive re-renders predictably and clear exactly on add.
  const [kind, setKind] = useState<PaymentKind>('advance');
  const [due, setDue] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  return (
    <form
      className="row"
      aria-label={`Add a scheduled payment for ${vendor.name}`}
      onSubmit={(event) => {
        event.preventDefault();
        const amountMinor = parseMajorAmount(amount.trim(), plan.currency);
        if (amountMinor === null || due.length === 0) return;
        onAdd({
          id: `i-${Date.now().toString(36)}`,
          kind,
          dueISO: due,
          amountMinor,
          note: note.trim(),
        });
        setKind('advance');
        setDue('');
        setAmount('');
        setNote('');
      }}
    >
      <div>
        <label htmlFor={`${vendor.id}-kind`}>Add payment</label>
        <select
          id={`${vendor.id}-kind`}
          value={kind}
          onChange={(event) => {
            // Proven before it is typed: the select is user input.
            const kind = parseEnum(event.target.value, PAYMENT_KINDS);
            if (kind !== null) setKind(kind);
          }}
        >
          {PAYMENT_KINDS.map((option) => (
            <option key={option} value={option}>
              {KIND_LABELS[option]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${vendor.id}-due`}>Due date</label>
        <input
          id={`${vendor.id}-due`}
          type="date"
          required
          value={due}
          onChange={(event) => {
            setDue(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-amount`}>Amount</label>
        <input
          id={`${vendor.id}-amount`}
          inputMode="decimal"
          required
          value={amount}
          onChange={(event) => {
            setAmount(event.target.value);
          }}
        />
      </div>
      <div>
        <label htmlFor={`${vendor.id}-sched-note`}>Reference (optional)</label>
        <input
          id={`${vendor.id}-sched-note`}
          value={note}
          maxLength={500}
          onChange={(event) => {
            setNote(event.target.value);
          }}
        />
      </div>
      <button type="submit">Add to schedule</button>
    </form>
  );
}
