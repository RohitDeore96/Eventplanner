import type { Plan } from '../../../../engine/types';
import { riskFlags } from '../../../../lib/quoteCompare';
import { money } from '../../../../lib/format';
import type { QuoteFields } from '../../../../schemas/ai';

/** The extracted fields, honestly labelled, with the deterministic check list. */
export function ExtractedQuoteView({
  plan,
  result,
}: {
  plan: Plan;
  result: QuoteFields & { source: string };
}): React.ReactNode {
  const flags = riskFlags(result, plan);
  const rows: readonly { readonly label: string; readonly value: string }[] = [
    { label: 'Vendor', value: result.vendorName ?? 'Not stated' },
    {
      label: 'Total',
      value: result.totalPriceMinor === null ? 'Not stated' : money(result.totalPriceMinor, plan),
    },
    {
      label: 'Per plate',
      value:
        result.pricePerPlateMinor === null ? 'Not stated' : money(result.pricePerPlateMinor, plan),
    },
    {
      label: 'Guest minimum',
      value: result.guestMinimum === null ? 'Not stated' : String(result.guestMinimum),
    },
    {
      label: 'Advance',
      value: result.advancePercent === null ? 'Not stated' : `${result.advancePercent}%`,
    },
    {
      label: 'Tax included',
      value: result.taxIncluded === null ? 'Not stated' : result.taxIncluded ? 'Yes' : 'No',
    },
    { label: 'Cancellation', value: result.cancellationPolicy ?? 'Not stated' },
  ];
  return (
    <div aria-live="polite">
      <table tabIndex={0}>
        <caption className="visually-hidden">Extracted quote fields</caption>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {flags.length > 0 && (
        <div className="alert">
          <strong>
            <span aria-hidden="true">⚠️</span> Things to check
          </strong>
          <ul>
            {flags.map((flag) => (
              <li key={flag}>{flag}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="muted">Read by {result.source} — verify against the original before booking.</p>
    </div>
  );
}
