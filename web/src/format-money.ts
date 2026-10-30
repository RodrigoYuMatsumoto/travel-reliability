/** Avoid floating-point division when displaying exact integer minor units. */
export function formatMinor(minor: number, currency: string, locale: string): string {
  if (!Number.isSafeInteger(minor)) return '—';
  const formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const places = formatter.resolvedOptions().maximumFractionDigits ?? 2;
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
