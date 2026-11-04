import { Temporal } from '@js-temporal/polyfill';
import { receipt, safeInteger, validatePassive } from '../../agent/provenance.js';
import {
  packageArbitrageSchema,
  type BreakfastAddOnQuote,
  type ExtraQuote,
  type LodgingQuote,
  type PackageArbitrageInput,
  type TransportQuote,
} from '../../schema/src/package-arbitrage.js';
import { AppError, requireCondition } from './errors.js';

type Mode = 'bus' | 'air';
type Board = 'with_breakfast' | 'room_only';
type Component = 'transport' | 'lodging' | 'breakfast_add_on' | 'extra';
type Classification = 'agency_premium' | 'agency_discount' | 'parity' | 'not_computable';
interface Line {
  quoteId: string;
  component: Component;
  formula: string;
  total: bigint | null;
  blockers: string[];
}
interface Ignored {
  quoteId: string;
  reasons: string[];
}
interface Selection {
  chosen: Line[] | null;
  reasons: string[];
  ignored: Ignored[];
}

const modes: readonly Mode[] = ['bus', 'air'];
const boards: readonly Board[] = ['with_breakfast', 'room_only'];
const labelsPt: Record<Classification, string> = {
  agency_premium: 'ágio da agência',
  agency_discount: 'deságio da agência',
  parity: 'paridade',
  not_computable: 'não calculável',
};

/**
 * Freshness window for every source, package page included. This is a policy of this
 * calculator, not a legal or industry norm: published package and fare prices change
 * quickly, so an observation older than this keeps the result non-final. Exactly the
 * window is still fresh; anything older is stale.
 */
export const PACKAGE_ARBITRAGE_SOURCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Identifiers and codes are ASCII, so plain code-unit comparison is ASCII order.
const ascii = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const codes = (values: Iterable<string>) => [...new Set(values)].sort(ascii);
const byQuoteId = (a: { quoteId: string }, b: { quoteId: string }) => ascii(a.quoteId, b.quoteId);

function instant(value: string): number {
  try {
    return Number(Temporal.Instant.from(value).epochMilliseconds);
  } catch {
    throw new AppError('PACKAGE_ARBITRAGE_TIME_REJECTED', 422);
  }
}
/** Signed counterpart of safeInteger, with the same stable code for unsafe output. */
function signedInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new AppError('INTELLIGENCE_INTEGER_OVERFLOW', 422);
  return result;
}
const nullableInteger = (value: bigint | null) => (value === null ? null : safeInteger(value));

/** delta / base in basis points; integer division rounding half away from zero. */
function basisPoints(delta: bigint, base: bigint): bigint | null {
  if (base <= 0n) return null;
  const numerator = delta * 10000n;
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = magnitude / base + ((magnitude % base) * 2n >= base ? 1n : 0n);
  return numerator < 0n ? -quotient : quotient;
}

const comboTotal = (combo: Line[]) =>
  combo.every((line) => line.total !== null)
    ? combo.reduce((sum, line) => sum + line.total!, 0n)
    : null;
const comboKey = (combo: Line[]) => combo.map((line) => line.quoteId).join(' ');
/** Cheapest fully priced combination; equal totals fall back to ASCII order of quote ids. */
function cheapest(combos: Line[][]): Line[] | null {
  let best: Line[] | null = null,
    bestTotal = 0n;
  for (const combo of combos) {
    const total = comboTotal(combo);
    if (total === null) continue;
    if (
      best === null ||
      total < bestTotal ||
      (total === bestTotal && comboKey(combo) < comboKey(best))
    ) {
      best = combo;
      bestTotal = total;
    }
  }
  return best;
}
const blockersOf = (combos: Line[][]) =>
  codes(combos.flatMap((combo) => combo.flatMap((line) => line.blockers)));

/**
 * Compares an agency package observation with caller-sourced unbundled quotes. No source
 * lookup, currency conversion, availability check, discount, model inference or purchase
 * occurs here. Unknown values stay null and keep the result non-final.
 */
export function packageArbitrage(supplied: unknown) {
  validatePassive(packageArbitrageSchema, supplied);
  const input = supplied as PackageArbitrageInput,
    observation = input.package,
    party = input.party,
    quotes = input.quotes;
  const allQuotes = [
    ...quotes.transport,
    ...quotes.lodging,
    ...quotes.breakfastAddOn,
    ...quotes.extras,
  ];
  const unique = (ids: string[]) =>
    requireCondition(new Set(ids).size === ids.length, 'PACKAGE_ARBITRAGE_DUPLICATE_ID', 422);
  unique(input.sources.map((source) => source.id));
  unique(allQuotes.map((quote) => quote.id));
  const now = instant(input.evaluatedAt);
  const knownSources = new Set(input.sources.map((source) => source.id));
  const pending: string[] = [];

  // Provenance gaps are pending items, never rejections: a source must be observed by the
  // caller (not declared or indicative), not later than the evaluation and not stale.
  const stale = (observedAt: number) => now - observedAt > PACKAGE_ARBITRAGE_SOURCE_MAX_AGE_MS;
  for (const source of input.sources) {
    const observedAt = instant(source.observedAt);
    if (observedAt > now) pending.push('SOURCE_AFTER_EVALUATION:' + source.id);
    if (stale(observedAt)) pending.push('SOURCE_STALE:' + source.id);
    if (source.status !== 'observed') pending.push('SOURCE_NOT_OBSERVED:' + source.id);
  }
  const packageObservedAt = instant(observation.source.observedAt);
  if (packageObservedAt > now) pending.push('PACKAGE_SOURCE_AFTER_EVALUATION');
  if (stale(packageObservedAt)) pending.push('PACKAGE_SOURCE_STALE');
  for (const quote of allQuotes)
    if (quote.sourceIds.length === 0 || !quote.sourceIds.every((id) => knownSources.has(id)))
      pending.push('QUOTE_WITHOUT_SOURCE:' + quote.id);
  if (!observation.departure.yearStated) pending.push('YEAR_NOT_STATED');
  if (observation.price.qualifier === 'from') pending.push('PRICE_IS_FROM');
  if (observation.price.qualifier === 'unknown') pending.push('PRICE_QUALIFIER_UNKNOWN');
  for (const warning of observation.warnings) pending.push('PACKAGE_' + warning);

  // Paying persons: a child price is never inferred as free, discounted or adult.
  let payingPersons: number | null = party.adults;
  if (party.children > 0) {
    if (party.childrenPayAdultPrice === true) payingPersons = party.adults + party.children;
    else if (party.childrenPayAdultPrice === false) pending.push('CHILD_PRICE_NOT_MODELED');
    else {
      payingPersons = null;
      pending.push('CHILD_PRICE_UNKNOWN');
    }
  }
  const persons = payingPersons === null ? null : BigInt(payingPersons);

  // Package total: published price times its basis, plus mandatory fees by payment:
  // - in_package: already inside the published price. Never added; reported apart as
  //   includedFeesMinor so the price is not counted twice.
  // - paid_locally: outside the published price. Added to the total and also reported
  //   apart as localCashMinor.
  // - unknown: it is not known whether the price already contains it. Not added (that
  //   could inflate the total); PACKAGE_FEE_PAYMENT_UNKNOWN keeps the result non-final and
  //   both fee subtotals become null, since the fee belongs to one of them.
  const price = observation.price;
  const packageGaps: string[] = [];
  if (price.currency !== input.currency) packageGaps.push('PACKAGE_CURRENCY_MISMATCH');
  if (price.amountMinor === null) packageGaps.push('PACKAGE_PRICE_UNKNOWN');
  if (price.basis === 'unknown') packageGaps.push('PACKAGE_PRICE_BASIS_UNKNOWN');
  if (persons === null) packageGaps.push('CHILD_PRICE_UNKNOWN');
  const add = (sum: bigint | null, value: bigint | null) =>
    sum === null || value === null ? null : sum + value;
  let feesTotal: bigint | null = 0n,
    includedFeesSum: bigint | null = 0n,
    paymentUnknown = false;
  for (const fee of observation.mandatoryFees) {
    const feeTotal =
      fee.basis === 'per_group'
        ? BigInt(fee.amountMinor)
        : fee.basis === 'per_person' && persons !== null
          ? BigInt(fee.amountMinor) * persons
          : null;
    if (fee.payment === 'paid_locally') {
      if (fee.basis === 'unknown') packageGaps.push('PACKAGE_FEE_BASIS_UNKNOWN');
      feesTotal = add(feesTotal, feeTotal);
    } else if (fee.payment === 'in_package') includedFeesSum = add(includedFeesSum, feeTotal);
    else paymentUnknown = true;
  }
  if (paymentUnknown) pending.push('PACKAGE_FEE_PAYMENT_UNKNOWN');
  // Fee subtotals are expressed in the comparison currency only; never converted.
  const reportable = price.currency === input.currency && !paymentUnknown;
  const localCash = reportable ? feesTotal : null,
    includedFees = reportable ? includedFeesSum : null;
  const multiplier =
    price.basis === 'per_person'
      ? persons
      : price.basis === 'per_room'
        ? BigInt(party.rooms)
        : price.basis === 'per_group'
          ? 1n
          : null;
  const gaps = codes(packageGaps);
  pending.push(...gaps);
  const packageTotal =
    gaps.length === 0 && price.amountMinor !== null && multiplier !== null && feesTotal !== null
      ? BigInt(price.amountMinor) * multiplier + feesTotal
      : null;

  // Lodging nights are hotel nights; a night spent on the bus is not a lodging night.
  const lodgingNights = observation.lodging.nightsIncluded ?? observation.nights;
  if (observation.lodging.nightsIncluded === null)
    pending.push(lodgingNights === null ? 'PACKAGE_NIGHTS_UNKNOWN' : 'LODGING_NIGHTS_NOT_STATED');
  const breakfast = observation.breakfast;
  // Hotel nights do not establish how many breakfasts the package supplies.
  // An explicit zero remains distinct from a missing count.
  const breakfastDays = breakfast.count;
  if (breakfast.status === 'included' && breakfast.count === null)
    pending.push('BREAKFAST_COUNT_UNKNOWN');

  const line = (
    quote: { id: string; unitMinor: number | null; currency: string },
    component: Component,
    unknownCode: string,
    factors: ReadonlyArray<readonly [number | null, string]>,
  ): Line => {
    const blockers: string[] = [];
    if (quote.currency !== input.currency) blockers.push('CURRENCY_MISMATCH');
    if (quote.unitMinor === null) blockers.push(unknownCode);
    if (factors.some(([value]) => value === null)) blockers.push('PAYING_PERSONS_UNKNOWN');
    const total = blockers.length
      ? null
      : factors.reduce((product, [value]) => product * BigInt(value!), BigInt(quote.unitMinor!));
    return {
      quoteId: quote.id,
      component,
      formula: [
        quote.unitMinor ?? 'unknown',
        ...factors.map(([value, label]) => `${value ?? 'unknown'} ${label}`),
      ].join(' x '),
      total,
      blockers,
    };
  };
  const transportLine = (quote: TransportQuote) =>
    line(
      quote,
      'transport',
      'TRANSPORT_PRICE_UNKNOWN',
      quote.unit === 'person' ? [[payingPersons, 'paying persons']] : [],
    );
  const lodgingLine = (quote: LodgingQuote) =>
    line(
      quote,
      'lodging',
      'LODGING_PRICE_UNKNOWN',
      quote.unit === 'room_night'
        ? [
            [quote.nights, 'nights'],
            [quote.rooms, 'rooms'],
          ]
        : [[quote.rooms, 'rooms']],
    );
  const addOnLine = (quote: BreakfastAddOnQuote) =>
    line(quote, 'breakfast_add_on', 'BREAKFAST_PRICE_UNKNOWN', [
      [quote.days, 'days'],
      [payingPersons, 'paying persons'],
    ]);
  const extraLine = (quote: ExtraQuote) =>
    line(
      quote,
      'extra',
      'EXTRA_PRICE_UNKNOWN',
      quote.unit === 'person'
        ? [
            [quote.quantity, 'units'],
            [payingPersons, 'paying persons'],
          ]
        : [[quote.quantity, 'units']],
    );

  // Transport is complete as one round trip or as one outbound plus one return leg.
  const selectTransport = (mode: Mode): Selection & { baggageIncluded: boolean | null } => {
    const relevant = quotes.transport.filter((quote) => quote.mode === mode);
    const lines = new Map(relevant.map((quote) => [quote.id, transportLine(quote)]));
    const legs = (coverage: TransportQuote['coverage']) =>
      relevant.filter((quote) => quote.coverage === coverage).map((quote) => lines.get(quote.id)!);
    const outbound = legs('outbound'),
      inbound = legs('return');
    const combos = [
      ...legs('round_trip').map((leg) => [leg]),
      ...outbound.flatMap((out) => inbound.map((back) => [out, back])),
    ];
    const chosen = cheapest(combos);
    const reasons = chosen
      ? []
      : relevant.length === 0
        ? ['TRANSPORT_QUOTE_MISSING']
        : combos.length === 0
          ? ['TRANSPORT_INCOMPLETE']
          : blockersOf(combos);
    const ignored = relevant
      .map((quote) => {
        const orphan =
          (quote.coverage === 'outbound' && inbound.length === 0) ||
          (quote.coverage === 'return' && outbound.length === 0);
        return {
          quoteId: quote.id,
          reasons: codes([
            ...lines.get(quote.id)!.blockers,
            ...(orphan ? ['MISSING_OPPOSITE_LEG'] : []),
          ]),
        };
      })
      .filter((row) => row.reasons.length > 0);
    const baggage = (chosen ?? []).map(
      (leg) => relevant.find((quote) => quote.id === leg.quoteId)!.baggageIncluded,
    );
    return {
      chosen,
      reasons,
      ignored,
      baggageIncluded:
        chosen === null
          ? null
          : baggage.includes(false)
            ? false
            : baggage.every((value) => value === true)
              ? true
              : null,
    };
  };

  // Lodging must match the package lodging nights and the party rooms.
  const lodgingIssues = (quote: LodgingQuote) => {
    const issues: string[] = [];
    if (lodgingNights === null) issues.push('PACKAGE_NIGHTS_UNKNOWN');
    else if (quote.nights !== lodgingNights) issues.push('NIGHTS_DIFFER');
    if (quote.rooms !== party.rooms) issues.push('ROOMS_DIFFER');
    return issues;
  };
  const addOnIssues = (quote: BreakfastAddOnQuote) =>
    breakfastDays === null
      ? ['BREAKFAST_COUNT_UNKNOWN']
      : quote.days !== breakfastDays
        ? ['DAYS_DIFFER']
        : [];
  const selectStay = (board: Board): Selection & { nightsDiffer: boolean } => {
    const roomOnly = quotes.lodging.filter((quote) => quote.board === 'room_only');
    const withBreakfast =
      board === 'with_breakfast'
        ? quotes.lodging.filter((quote) => quote.board === 'breakfast')
        : [];
    const addOns = board === 'with_breakfast' ? quotes.breakfastAddOn : [];
    const relevant = [...withBreakfast, ...roomOnly];
    const lines = new Map(relevant.map((quote) => [quote.id, lodgingLine(quote)]));
    const addOnLines = new Map(addOns.map((quote) => [quote.id, addOnLine(quote)]));
    const fits = (quote: LodgingQuote) => lodgingIssues(quote).length === 0;
    const usableAddOns = addOns.filter((quote) => addOnIssues(quote).length === 0);
    const combos =
      board === 'room_only'
        ? roomOnly.filter(fits).map((quote) => [lines.get(quote.id)!])
        : [
            ...withBreakfast.filter(fits).map((quote) => [lines.get(quote.id)!]),
            ...roomOnly
              .filter(fits)
              .flatMap((quote) =>
                usableAddOns.map((addOn) => [lines.get(quote.id)!, addOnLines.get(addOn.id)!]),
              ),
          ];
    const chosen = cheapest(combos);
    const reasons = chosen
      ? []
      : relevant.length === 0
        ? ['LODGING_QUOTE_MISSING']
        : !relevant.some(fits)
          ? ['NO_COMPATIBLE_LODGING']
          : combos.length === 0
            ? [addOns.length === 0 ? 'BREAKFAST_QUOTE_MISSING' : 'NO_COMPATIBLE_BREAKFAST']
            : blockersOf(combos);
    const ignored = [
      ...relevant.map((quote) => ({
        quoteId: quote.id,
        reasons: codes([...lodgingIssues(quote), ...lines.get(quote.id)!.blockers]),
      })),
      ...addOns.map((quote) => ({
        quoteId: quote.id,
        reasons: codes([...addOnIssues(quote), ...addOnLines.get(quote.id)!.blockers]),
      })),
    ].filter((row) => row.reasons.length > 0);
    return {
      chosen,
      reasons,
      ignored,
      nightsDiffer:
        chosen === null && relevant.some((quote) => lodgingIssues(quote).includes('NIGHTS_DIFFER')),
    };
  };

  // Only extras that reproduce a package inclusion belong to the unbundled equivalent.
  const extraLines = quotes.extras
    .filter((quote) => quote.mirrorsPackageInclusion)
    .map(extraLine)
    .sort(byQuoteId);
  const extraBlockers = codes(extraLines.flatMap((extra) => extra.blockers));

  const transportByMode = new Map(modes.map((mode) => [mode, selectTransport(mode)]));
  const stayByBoard = new Map(boards.map((board) => [board, selectStay(board)]));
  const scenarioModes = modes.filter(
    (mode) => mode === observation.modal || quotes.transport.some((quote) => quote.mode === mode),
  );
  const scenarios = scenarioModes.flatMap((mode) =>
    boards.map((board) => {
      const transport = transportByMode.get(mode)!,
        stay = stayByBoard.get(board)!;
      const lines = [...(transport.chosen ?? []), ...(stay.chosen ?? []), ...extraLines];
      const unbundled =
        transport.chosen !== null && stay.chosen !== null && extraBlockers.length === 0
          ? lines.reduce((sum, item) => sum + item.total!, 0n)
          : null;
      const delta = packageTotal !== null && unbundled !== null ? packageTotal - unbundled : null;
      const classification: Classification =
        delta === null
          ? 'not_computable'
          : delta > 0n
            ? 'agency_premium'
            : delta < 0n
              ? 'agency_discount'
              : 'parity';
      const lodgingId = stay.chosen?.find((item) => item.component === 'lodging')?.quoteId;
      const addOnId = stay.chosen?.find((item) => item.component === 'breakfast_add_on')?.quoteId;
      const lodging = quotes.lodging.find((quote) => quote.id === lodgingId) ?? null;
      const addOn = quotes.breakfastAddOn.find((quote) => quote.id === addOnId) ?? null;
      const breakfastCount =
        board === 'room_only' ? 0 : (addOn?.days ?? (lodging ? lodging.nights : null));
      // Equivalence is scope only: an alternative is shown but never called savings.
      const equivalence: string[] = [];
      if (observation.modal === 'unknown') equivalence.push('MODE_UNKNOWN');
      else if (observation.modal !== mode) equivalence.push('MODE_DIFFERS');
      if (breakfast.status === 'partial') equivalence.push('BREAKFAST_PARTIAL');
      else if (breakfast.status === 'unknown') equivalence.push('BREAKFAST_UNKNOWN');
      else if ((board === 'with_breakfast') !== (breakfast.status === 'included'))
        equivalence.push('BOARD_DIFFERS');
      else if (board === 'with_breakfast' && breakfast.count === null)
        equivalence.push('BREAKFAST_COUNT_UNKNOWN');
      else if (
        board === 'with_breakfast' &&
        breakfast.count !== null &&
        breakfastCount !== null &&
        breakfastCount !== breakfast.count
      )
        equivalence.push('BREAKFAST_COUNT_DIFFERS');
      if (lodgingNights === null) equivalence.push('NIGHTS_UNKNOWN');
      else if (lodging === null)
        equivalence.push(stay.nightsDiffer ? 'NIGHTS_DIFFER' : 'NIGHTS_UNCONFIRMED');
      const ratio = delta === null || unbundled === null ? null : basisPoints(delta, unbundled);
      // A zero unbundled total has no percentage base and is never a final comparison.
      const zero = unbundled === 0n ? ['UNBUNDLED_TOTAL_ZERO'] : [];
      return {
        id: `${mode}:${board}`,
        mode,
        board,
        status: delta === null ? ('not_computable' as const) : ('computed' as const),
        reasons: codes([...gaps, ...transport.reasons, ...stay.reasons, ...extraBlockers, ...zero]),
        chosen: {
          transportIds: (transport.chosen ?? []).map((item) => item.quoteId),
          lodgingId: lodging?.id ?? null,
          breakfastAddOnId: addOn?.id ?? null,
          extraIds: extraLines.map((item) => item.quoteId),
        },
        lines: lines.map((item) => ({
          quoteId: item.quoteId,
          component: item.component,
          formula: item.formula,
          totalMinor: nullableInteger(item.total),
        })),
        lodgingNights: lodging?.nights ?? null,
        breakfastCount,
        baggageIncluded: transport.baggageIncluded,
        packageTotalMinor: nullableInteger(packageTotal),
        unbundledTotalMinor: nullableInteger(unbundled),
        deltaMinor: delta === null ? null : signedInteger(delta),
        deltaBasisPoints: ratio === null ? null : signedInteger(ratio),
        classification,
        labelPt: labelsPt[classification],
        equivalent: equivalence.length === 0,
        equivalenceReasons: codes(equivalence),
        ignoredQuotes: [...transport.ignored, ...stay.ignored].sort(byQuoteId),
      };
    }),
  );

  const bestEquivalent =
    scenarios
      .filter((scenario) => scenario.status === 'computed' && scenario.equivalent)
      .sort((a, b) => a.unbundledTotalMinor! - b.unbundledTotalMinor! || ascii(a.id, b.id))[0]
      ?.id ?? null;
  if (bestEquivalent === null) pending.push('NO_EQUIVALENT_SCENARIO');
  if (scenarios.some((scenario) => scenario.reasons.includes('UNBUNDLED_TOTAL_ZERO')))
    pending.push('UNBUNDLED_TOTAL_ZERO');
  const pendingCodes = codes(pending);
  const result = {
    packageTotalMinor: nullableInteger(packageTotal),
    includedFeesMinor: nullableInteger(includedFees),
    localCashMinor: nullableInteger(localCash),
    payingPersons,
    scenarios,
    bestEquivalent,
    pending: pendingCodes,
    currency: input.currency,
    final: pendingCodes.length === 0,
  };
  return {
    ...result,
    calculationReceipt: receipt('package-arbitrage', input, result, input.evaluatedAt),
  };
}
