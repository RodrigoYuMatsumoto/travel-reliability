import type { Review } from '../../schema/src/domain.js';
/** Compare supplied statements only; no inference about actual delivery or authenticity. */
export function summarizeComparisons(
  comparisons: NonNullable<Review['comparisons']>,
): NonNullable<Review['comparisonSummary']> {
  const normalize = (value: string | null) =>
    value?.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US') ?? '';
  let compared = 0,
    differentText = 0,
    incomplete = 0;
  for (const item of comparisons) {
    const advertised = normalize(item.advertised),
      observed = normalize(item.observed);
    if (!advertised || !observed) {
      incomplete++;
      continue;
    }
    compared++;
    if (advertised !== observed) differentText++;
  }
  return { compared, differentText, incomplete, verification: 'traveler_report_only' };
}
