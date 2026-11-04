import { currencyMinorUnits } from '../../schema/src/currency';
/**
 * Avoid floating-point division when displaying exact integer minor units. The scale comes
 * from ISO 4217 (the contract's unit), not from CLDR display digits, which differ for
 * currencies such as IQD (ISO 3, CLDR 0) or HUF (ISO 2, CLDR 0).
 */
export function formatMinor(minor: number, currency: string, locale: string): string {
  const places = currencyMinorUnits(currency);
  if (!Number.isSafeInteger(minor) || places === null) return '—';
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  const scale = 10n ** BigInt(places),
    amount = BigInt(minor),
    whole = amount / scale;
  const fraction = (amount < 0n ? -amount : amount) % scale;
  return formatter
    .formatToParts(whole === 0n && minor < 0 ? -0 : whole)
    .map((part) =>
      part.type === 'fraction' ? fraction.toString().padStart(places, '0') : part.value,
    )
    .join('');
}
