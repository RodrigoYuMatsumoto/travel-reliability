import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { plan } from '../api/src/planning.js';
import {
  packageArbitrage,
  PACKAGE_ARBITRAGE_SOURCE_MAX_AGE_MS,
} from '../api/src/package-arbitrage.js';
import type { PackageArbitrageInput } from '../schema/src/package-arbitrage.js';
import { packageArbitrageExample } from '../web/src/package-arbitrage-example.js';

type Result = ReturnType<typeof packageArbitrage>;
const load = (): PackageArbitrageInput =>
  JSON.parse(readFileSync(new URL('../examples/package-arbitrage.json', import.meta.url), 'utf8'));
const run = (input: unknown) => plan('package-arbitrage', input).result as Result;
const scenario = (result: Result, id: string) => {
  const found = result.scenarios.find((row) => row.id === id);
  expect(found, id).toBeDefined();
  return found!;
};

describe('regional package arbitrage', () => {
  it('keeps the JSON example identical to the example used by the interface', () => {
    expect(load()).toEqual(packageArbitrageExample);
  });

  it('runs the synthetic example through the planning registry without external calls', () => {
    const output = plan('package-arbitrage', load());
    expect(output).toMatchObject({
      tool: 'package-arbitrage',
      mode: 'documentary',
      externalCalls: 0,
      audit: { factsVerified: false },
    });
    const result = output.result as Result;
    expect(result.final).toBe(true);
    expect(result.pending).toEqual([]);
    expect(result.bestEquivalent).toBe('bus:with_breakfast');
    expect(result.scenarios.map((row) => row.id)).toEqual([
      'bus:with_breakfast',
      'bus:room_only',
      'air:with_breakfast',
      'air:room_only',
    ]);
    expect(result.calculationReceipt).toMatchObject({
      format: 'travel-reliability-calculation-receipt/1',
      calculatorId: 'package-arbitrage',
      evaluatedAt: '2030-01-10T12:00:00Z',
    });
  });

  it('shows an agency premium for the equivalent bus scenario with breakfast', () => {
    const result = run(load());
    expect(result.packageTotalMinor).toBe(181000);
    expect(result.localCashMinor).toBe(3000);
    expect(result.payingPersons).toBe(2);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row).toMatchObject({
      status: 'computed',
      reasons: [],
      chosen: {
        transportIds: ['bus-rt'],
        lodgingId: 'hotel-breakfast',
        breakfastAddOnId: null,
        extraIds: ['city-tour', 'tourism-fee'],
      },
      // Four package nights, two of them on the bus: only two are lodging nights.
      lodgingNights: 2,
      breakfastCount: 2,
      baggageIncluded: true,
      packageTotalMinor: 181000,
      unbundledTotalMinor: 135000,
      deltaMinor: 46000,
      deltaBasisPoints: 3407,
      classification: 'agency_premium',
      labelPt: 'ágio da agência',
      equivalent: true,
      equivalenceReasons: [],
      ignoredQuotes: [],
    });
    expect(row.lines).toEqual([
      {
        quoteId: 'bus-rt',
        component: 'transport',
        formula: '32000 x 2 paying persons',
        totalMinor: 64000,
      },
      {
        quoteId: 'hotel-breakfast',
        component: 'lodging',
        formula: '26000 x 2 nights x 1 rooms',
        totalMinor: 52000,
      },
      {
        quoteId: 'city-tour',
        component: 'extra',
        formula: '8000 x 1 units x 2 paying persons',
        totalMinor: 16000,
      },
      {
        quoteId: 'tourism-fee',
        component: 'extra',
        formula: '1500 x 1 units x 2 paying persons',
        totalMinor: 3000,
      },
    ]);
  });

  it('shows an agency discount and parity without calling an alternative a saving', () => {
    const value = load();
    value.quotes.transport[0]!.unitMinor = 70000;
    const discount = run(value);
    expect(scenario(discount, 'bus:with_breakfast')).toMatchObject({
      unbundledTotalMinor: 211000,
      deltaMinor: -30000,
      deltaBasisPoints: -1422,
      classification: 'agency_discount',
      labelPt: 'deságio da agência',
      equivalent: true,
    });
    expect(discount.bestEquivalent).toBe('bus:with_breakfast');
    expect(discount.final).toBe(true);
    const even = load();
    even.quotes.transport[0]!.unitMinor = 55000;
    expect(scenario(run(even), 'bus:with_breakfast')).toMatchObject({
      deltaMinor: 0,
      deltaBasisPoints: 0,
      classification: 'parity',
      labelPt: 'paridade',
    });
  });

  it('keeps room-only lodging as an alternative unless the package excludes breakfast', () => {
    const result = run(load());
    expect(scenario(result, 'bus:room_only')).toMatchObject({
      status: 'computed',
      chosen: { lodgingId: 'hotel-room-only', breakfastAddOnId: null },
      breakfastCount: 0,
      unbundledTotalMinor: 125000,
      deltaMinor: 56000,
      deltaBasisPoints: 4480,
      equivalent: false,
      equivalenceReasons: ['BOARD_DIFFERS'],
    });
    const excluded = load();
    excluded.package.breakfast = { status: 'excluded', count: null };
    const roomOnly = run(excluded);
    expect(roomOnly.bestEquivalent).toBe('bus:room_only');
    expect(scenario(roomOnly, 'bus:with_breakfast').equivalenceReasons).toEqual(['BOARD_DIFFERS']);
    const partial = load();
    partial.package.breakfast = { status: 'partial', count: 1 };
    const partialResult = run(partial);
    expect(scenario(partialResult, 'bus:with_breakfast').equivalenceReasons).toEqual([
      'BREAKFAST_PARTIAL',
    ]);
    expect(partialResult.bestEquivalent).toBeNull();
  });

  it('builds breakfast from room-only lodging plus a separate breakfast when cheaper or alone', () => {
    const value = load();
    value.quotes.lodging = value.quotes.lodging.filter((quote) => quote.board === 'room_only');
    const row = scenario(run(value), 'bus:with_breakfast');
    expect(row).toMatchObject({
      chosen: { lodgingId: 'hotel-room-only', breakfastAddOnId: 'breakfast-separate' },
      breakfastCount: 2,
      unbundledTotalMinor: 137000,
      equivalent: true,
    });
    expect(row.lines.find((line) => line.quoteId === 'breakfast-separate')).toMatchObject({
      formula: '3000 x 2 days x 2 paying persons',
      totalMinor: 12000,
    });
    value.quotes.breakfastAddOn = [];
    expect(scenario(run(value), 'bus:with_breakfast')).toMatchObject({
      status: 'not_computable',
      reasons: ['BREAKFAST_QUOTE_MISSING'],
      unbundledTotalMinor: null,
    });
  });

  it('does not infer an included breakfast count from lodging nights or certify unknown meal equivalence', () => {
    const value = load();
    value.package.breakfast.count = null;
    const result = run(value);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row.unbundledTotalMinor).toBe(135000);
    expect(row.equivalent).toBe(false);
    expect(row.equivalenceReasons).toContain('BREAKFAST_COUNT_UNKNOWN');
    expect(result.pending).toContain('BREAKFAST_COUNT_UNKNOWN');
    expect(result.bestEquivalent).toBeNull();
    expect(result.final).toBe(false);
  });

  it('does not choose a separate breakfast quote by silently replacing the missing package count with nights', () => {
    const value = load();
    value.package.breakfast.count = null;
    value.quotes.lodging = value.quotes.lodging.filter((quote) => quote.board === 'room_only');
    const result = run(value);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row.status).toBe('not_computable');
    expect(row.chosen.breakfastAddOnId).toBeNull();
    expect(row.unbundledTotalMinor).toBeNull();
    expect(row.equivalenceReasons).toContain('BREAKFAST_COUNT_UNKNOWN');
    expect(row.ignoredQuotes).toContainEqual({
      quoteId: 'breakfast-separate',
      reasons: ['BREAKFAST_COUNT_UNKNOWN'],
    });
    expect(result.final).toBe(false);
  });

  it('preserves an explicitly stated zero count rather than classifying it as unknown', () => {
    const value = load();
    value.package.breakfast.count = 0;
    value.quotes.breakfastAddOn[0]!.days = 0;
    const result = run(value);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row.breakfastCount).toBe(0);
    expect(row.chosen).toMatchObject({
      lodgingId: 'hotel-room-only',
      breakfastAddOnId: 'breakfast-separate',
    });
    expect(row.lines.find((line) => line.component === 'breakfast_add_on')!.totalMinor).toBe(0);
    expect(row.unbundledTotalMinor).toBe(125000);
    expect(row.equivalent).toBe(true);
    expect(result.pending).not.toContain('BREAKFAST_COUNT_UNKNOWN');
    expect(result.final).toBe(true);
  });

  it('keeps excluded zero-breakfast planning equivalent to room-only without a meal add-on', () => {
    const value = load();
    value.package.breakfast = { status: 'excluded', count: 0 };
    value.quotes.breakfastAddOn = [];
    const result = run(value);
    const row = scenario(result, 'bus:room_only');
    expect(row.breakfastCount).toBe(0);
    expect(row.chosen.breakfastAddOnId).toBeNull();
    expect(row.lines.some((line) => line.component === 'breakfast_add_on')).toBe(false);
    expect(row.equivalent).toBe(true);
    expect(result.bestEquivalent).toBe('bus:room_only');
    expect(result.final).toBe(true);
  });

  it('prices the with-breakfast alternative of a package without breakfast from its lodging nights', () => {
    for (const count of [null, 0]) {
      const value = load();
      value.package.breakfast = { status: 'excluded', count };
      value.quotes.lodging = value.quotes.lodging.filter((quote) => quote.board === 'room_only');
      const result = run(value);
      const row = scenario(result, 'bus:with_breakfast');
      expect(row, String(count)).toMatchObject({
        status: 'computed',
        chosen: { lodgingId: 'hotel-room-only', breakfastAddOnId: 'breakfast-separate' },
        breakfastCount: 2,
        equivalent: false,
      });
      expect(row.equivalenceReasons).toContain('BOARD_DIFFERS');
      expect(row.ignoredQuotes.some((quote) => quote.quoteId === 'breakfast-separate')).toBe(false);
      expect(result.pending).not.toContain('BREAKFAST_COUNT_UNKNOWN');
      expect(result.bestEquivalent).toBe('bus:room_only');
    }
  });

  it('never adds an external breakfast charge to the selected breakfast-included hotel rate', () => {
    const value = load();
    value.quotes.breakfastAddOn[0]!.unitMinor = 100000;
    const row = scenario(run(value), 'bus:with_breakfast');
    expect(row.chosen.lodgingId).toBe('hotel-breakfast');
    expect(row.chosen.breakfastAddOnId).toBeNull();
    expect(row.lines.some((line) => line.component === 'breakfast_add_on')).toBe(false);
    expect(row.unbundledTotalMinor).toBe(135000);
  });

  it('treats air as an alternative and never as an equivalent of a bus package', () => {
    const result = run(load());
    expect(scenario(result, 'air:with_breakfast')).toMatchObject({
      status: 'computed',
      chosen: { transportIds: ['air-out', 'air-ret'] },
      baggageIncluded: false,
      unbundledTotalMinor: 231000,
      deltaMinor: -50000,
      deltaBasisPoints: -2165,
      classification: 'agency_discount',
      equivalent: false,
      equivalenceReasons: ['MODE_DIFFERS'],
    });
    expect(scenario(result, 'air:room_only').equivalenceReasons).toEqual([
      'BOARD_DIFFERS',
      'MODE_DIFFERS',
    ]);
    expect(result.bestEquivalent).toBe('bus:with_breakfast');
    for (const modal of ['mixed', 'unknown'] as const) {
      const value = load();
      value.package.modal = modal;
      const other = run(value);
      expect(other.scenarios.every((row) => !row.equivalent)).toBe(true);
      expect(other.bestEquivalent).toBeNull();
      expect(other.pending).toContain('NO_EQUIVALENT_SCENARIO');
      expect(other.final).toBe(false);
    }
  });

  it('refuses lodging whose nights or rooms differ from the package', () => {
    const value = load();
    for (const quote of value.quotes.lodging) quote.nights = 3;
    const result = run(value);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row).toMatchObject({
      status: 'not_computable',
      reasons: ['NO_COMPATIBLE_LODGING'],
      unbundledTotalMinor: null,
      deltaMinor: null,
      classification: 'not_computable',
      labelPt: 'não calculável',
      equivalent: false,
      equivalenceReasons: ['NIGHTS_DIFFER'],
    });
    expect(row.ignoredQuotes).toContainEqual({
      quoteId: 'hotel-breakfast',
      reasons: ['NIGHTS_DIFFER'],
    });
    expect(result.bestEquivalent).toBeNull();
    expect(result.pending).toContain('NO_EQUIVALENT_SCENARIO');
    const fallback = load();
    fallback.package.lodging.nightsIncluded = null;
    const tripNights = run(fallback);
    expect(tripNights.pending).toContain('LODGING_NIGHTS_NOT_STATED');
    expect(scenario(tripNights, 'bus:room_only').reasons).toEqual(['NO_COMPATIBLE_LODGING']);
    const rooms = load();
    rooms.party.rooms = 2;
    expect(scenario(run(rooms), 'bus:room_only').ignoredQuotes).toContainEqual({
      quoteId: 'hotel-room-only',
      reasons: ['ROOMS_DIFFER'],
    });
  });

  it('marks missing, incomplete or unpriced quotes as not computable instead of zero', () => {
    const none = load();
    none.quotes.transport = [];
    const missing = run(none);
    expect(missing.scenarios.map((row) => row.id)).toEqual(['bus:with_breakfast', 'bus:room_only']);
    expect(scenario(missing, 'bus:with_breakfast')).toMatchObject({
      status: 'not_computable',
      reasons: ['TRANSPORT_QUOTE_MISSING'],
      unbundledTotalMinor: null,
    });
    const oneWay = load();
    oneWay.quotes.transport[0]!.coverage = 'outbound';
    const incomplete = scenario(run(oneWay), 'bus:with_breakfast');
    expect(incomplete.reasons).toEqual(['TRANSPORT_INCOMPLETE']);
    expect(incomplete.ignoredQuotes).toContainEqual({
      quoteId: 'bus-rt',
      reasons: ['MISSING_OPPOSITE_LEG'],
    });
    const unpriced = load();
    unpriced.quotes.transport[0]!.unitMinor = null;
    const unknown = scenario(run(unpriced), 'bus:with_breakfast');
    expect(unknown.reasons).toEqual(['TRANSPORT_PRICE_UNKNOWN']);
    expect(unknown.unbundledTotalMinor).toBeNull();
    expect(unknown.lines.some((line) => line.component === 'transport')).toBe(false);
    const noLodging = load();
    noLodging.quotes.lodging = [];
    expect(scenario(run(noLodging), 'bus:room_only').reasons).toEqual(['LODGING_QUOTE_MISSING']);
    const extra = load();
    extra.quotes.extras[0]!.unitMinor = null;
    const extraRow = scenario(run(extra), 'bus:with_breakfast');
    expect(extraRow.reasons).toEqual(['EXTRA_PRICE_UNKNOWN']);
    expect(extraRow.lines.find((line) => line.quoteId === 'city-tour')!.totalMinor).toBeNull();
  });

  it('never infers a child price and never converts currencies', () => {
    const unknownChild = load();
    unknownChild.party.children = 1;
    const result = run(unknownChild);
    expect(result.payingPersons).toBeNull();
    expect(result.packageTotalMinor).toBeNull();
    expect(result.localCashMinor).toBeNull();
    expect(result.pending).toContain('CHILD_PRICE_UNKNOWN');
    expect(scenario(result, 'bus:with_breakfast')).toMatchObject({
      status: 'not_computable',
      classification: 'not_computable',
    });
    expect(scenario(result, 'bus:with_breakfast').reasons).toEqual(
      expect.arrayContaining(['CHILD_PRICE_UNKNOWN', 'PAYING_PERSONS_UNKNOWN']),
    );
    const adultPrice = load();
    adultPrice.party.children = 1;
    adultPrice.party.childrenPayAdultPrice = true;
    const adult = run(adultPrice);
    expect(adult.payingPersons).toBe(3);
    expect(adult.packageTotalMinor).toBe(271500);
    const ownPrice = load();
    ownPrice.party.children = 1;
    ownPrice.party.childrenPayAdultPrice = false;
    const own = run(ownPrice);
    expect(own.payingPersons).toBe(2);
    expect(own.packageTotalMinor).toBe(181000);
    expect(own.pending).toContain('CHILD_PRICE_NOT_MODELED');
    expect(own.final).toBe(false);

    const foreign = load();
    for (const quote of foreign.quotes.lodging) quote.currency = 'USD';
    const mismatch = scenario(run(foreign), 'bus:with_breakfast');
    expect(mismatch).toMatchObject({
      status: 'not_computable',
      reasons: ['CURRENCY_MISMATCH'],
      unbundledTotalMinor: null,
    });
    expect(mismatch.ignoredQuotes).toContainEqual({
      quoteId: 'hotel-breakfast',
      reasons: ['CURRENCY_MISMATCH'],
    });
    const oneForeign = load();
    oneForeign.quotes.lodging[0]!.currency = 'USD';
    expect(scenario(run(oneForeign), 'bus:with_breakfast').chosen).toMatchObject({
      lodgingId: 'hotel-room-only',
      breakfastAddOnId: 'breakfast-separate',
    });
    const foreignPackage = load();
    foreignPackage.package.price.currency = 'USD';
    const packageMismatch = run(foreignPackage);
    expect(packageMismatch.packageTotalMinor).toBeNull();
    expect(packageMismatch.localCashMinor).toBeNull();
    expect(packageMismatch.pending).toContain('PACKAGE_CURRENCY_MISMATCH');
  });

  it('turns a source observed after the evaluation into a pending item, not a rejection', () => {
    const value = load();
    value.sources[0]!.observedAt = '2030-01-10T13:00:00Z';
    const result = run(value);
    expect(result.pending).toEqual(['SOURCE_AFTER_EVALUATION:src-bus']);
    expect(result.final).toBe(false);
    expect(scenario(result, 'bus:with_breakfast').status).toBe('computed');
    const late = load();
    late.package.source.observedAt = '2030-01-11T00:00:00Z';
    expect(run(late).pending).toContain('PACKAGE_SOURCE_AFTER_EVALUATION');
    const unsourced = load();
    unsourced.quotes.transport[0]!.sourceIds = [];
    unsourced.quotes.lodging[0]!.sourceIds = ['src-missing'];
    expect(run(unsourced).pending).toEqual([
      'QUOTE_WITHOUT_SOURCE:bus-rt',
      'QUOTE_WITHOUT_SOURCE:hotel-breakfast',
    ]);
  });

  it('keeps declared and stale sources non-final with a 7-day boundary', () => {
    const evaluatedAt = Date.parse(load().evaluatedAt);
    const before = (ms: number) => new Date(evaluatedAt - ms).toISOString();
    const maxAge = PACKAGE_ARBITRAGE_SOURCE_MAX_AGE_MS;
    const exact = load();
    exact.sources[0]!.observedAt = before(maxAge);
    exact.package.source.observedAt = before(maxAge);
    expect(run(exact)).toMatchObject({ pending: [], final: true });
    const older = load();
    older.sources[0]!.observedAt = before(maxAge + 60000);
    older.package.source.observedAt = before(maxAge + 60000);
    expect(run(older)).toMatchObject({
      pending: ['PACKAGE_SOURCE_STALE', 'SOURCE_STALE:src-bus'],
      final: false,
    });
    const declared = load();
    declared.sources[2]!.status = 'declared';
    declared.sources[3]!.status = 'indicative';
    const result = run(declared);
    expect(result.pending).toEqual([
      'SOURCE_NOT_OBSERVED:src-hotel',
      'SOURCE_NOT_OBSERVED:src-tour',
    ]);
    expect(result.final).toBe(false);
    expect(scenario(result, 'bus:with_breakfast').status).toBe('computed');
  });

  it('flags a zero unbundled total instead of finalising a comparison without a base', () => {
    const value = load();
    value.quotes.transport[0]!.unitMinor = 0;
    for (const quote of value.quotes.lodging) quote.unitMinor = 0;
    for (const quote of value.quotes.extras) quote.unitMinor = 0;
    const result = run(value);
    const row = scenario(result, 'bus:with_breakfast');
    expect(row).toMatchObject({
      status: 'computed',
      reasons: ['UNBUNDLED_TOTAL_ZERO'],
      unbundledTotalMinor: 0,
      deltaMinor: 181000,
      deltaBasisPoints: null,
    });
    expect(scenario(result, 'air:with_breakfast').reasons).toEqual([]);
    expect(result.pending).toEqual(['UNBUNDLED_TOTAL_ZERO']);
    expect(result.final).toBe(false);
  });

  it('keeps a "from" price and an unstated year non-final', () => {
    const value = load();
    value.package.price.qualifier = 'from';
    value.package.departure.yearStated = false;
    value.package.warnings = ['YEAR_NOT_STATED'];
    const result = run(value);
    expect(result.pending).toEqual(['PACKAGE_YEAR_NOT_STATED', 'PRICE_IS_FROM', 'YEAR_NOT_STATED']);
    expect(result.final).toBe(false);
    expect(result.bestEquivalent).toBe('bus:with_breakfast');
    const unknown = load();
    unknown.package.price.qualifier = 'unknown';
    expect(run(unknown).pending).toContain('PRICE_QUALIFIER_UNKNOWN');
  });

  it('treats a static shell without price as not computable in every scenario', () => {
    const value = load();
    value.package.source.retrieval = 'static_html';
    value.package.price.amountMinor = null;
    value.package.price.installments = null;
    value.package.warnings = ['STATIC_SHELL_NOT_EVIDENCE'];
    const result = run(value);
    expect(result.packageTotalMinor).toBeNull();
    expect(result.localCashMinor).toBe(3000);
    for (const row of result.scenarios) {
      expect(row.status).toBe('not_computable');
      expect(row.reasons).toContain('PACKAGE_PRICE_UNKNOWN');
      expect(row.deltaMinor).toBeNull();
      expect(row.labelPt).toBe('não calculável');
    }
    expect(scenario(result, 'bus:with_breakfast').unbundledTotalMinor).toBe(135000);
    expect(result.bestEquivalent).toBeNull();
    expect(result.pending).toEqual(
      expect.arrayContaining([
        'NO_EQUIVALENT_SCENARIO',
        'PACKAGE_PRICE_UNKNOWN',
        'PACKAGE_STATIC_SHELL_NOT_EVIDENCE',
      ]),
    );
    const basis = load();
    basis.package.price.basis = 'unknown';
    const unknownBasis = run(basis);
    expect(unknownBasis.packageTotalMinor).toBeNull();
    expect(unknownBasis.pending).toContain('PACKAGE_PRICE_BASIS_UNKNOWN');
  });

  it('applies price basis and mandatory fees, reporting local cash apart', () => {
    const room = load();
    room.package.price.basis = 'per_room';
    room.package.price.amountMinor = 150000;
    expect(run(room).packageTotalMinor).toBe(153000);
    const group = load();
    group.package.mandatoryFees.push({
      label: 'Synthetic service fee',
      amountMinor: 5000,
      basis: 'per_group',
      payment: 'in_package',
    });
    // A fee already inside the published price is reported apart and never added again.
    expect(run(group)).toMatchObject({
      packageTotalMinor: 181000,
      includedFeesMinor: 5000,
      localCashMinor: 3000,
    });
    // A fee whose payment is unknown is not added either, and nothing becomes final.
    const unknownPayment = load();
    unknownPayment.package.mandatoryFees[0]!.payment = 'unknown';
    const payment = run(unknownPayment);
    expect(payment).toMatchObject({
      packageTotalMinor: 178000,
      includedFeesMinor: null,
      localCashMinor: null,
      final: false,
    });
    expect(payment.pending).toEqual(['PACKAGE_FEE_PAYMENT_UNKNOWN']);
    const unknownFee = load();
    unknownFee.package.mandatoryFees[0]!.basis = 'unknown';
    const fee = run(unknownFee);
    expect(fee).toMatchObject({ packageTotalMinor: null, localCashMinor: null });
    expect(fee.pending).toContain('PACKAGE_FEE_BASIS_UNKNOWN');
    // An unknown basis on an included fee leaves the total intact and its subtotal unknown.
    const includedUnknown = load();
    includedUnknown.package.mandatoryFees[0]!.payment = 'in_package';
    includedUnknown.package.mandatoryFees[0]!.basis = 'unknown';
    expect(run(includedUnknown)).toMatchObject({
      packageTotalMinor: 178000,
      includedFeesMinor: null,
      localCashMinor: 0,
    });
  });

  it('shows parity instead of a false premium when the fee is already in the package price', () => {
    const value = load();
    value.package.price.amountMinor = 67500;
    value.package.mandatoryFees[0]!.payment = 'in_package';
    const result = run(value);
    expect(result).toMatchObject({
      packageTotalMinor: 135000,
      includedFeesMinor: 3000,
      localCashMinor: 0,
      bestEquivalent: 'bus:with_breakfast',
      pending: [],
      final: true,
    });
    expect(scenario(result, 'bus:with_breakfast')).toMatchObject({
      unbundledTotalMinor: 135000,
      deltaMinor: 0,
      deltaBasisPoints: 0,
      classification: 'parity',
      labelPt: 'paridade',
      equivalent: true,
    });
    // The same page read as a locally paid fee is a real premium of the fee amount.
    value.package.mandatoryFees[0]!.payment = 'paid_locally';
    expect(scenario(run(value), 'bus:with_breakfast')).toMatchObject({
      deltaMinor: 3000,
      classification: 'agency_premium',
    });
  });

  it('rounds basis points half away from zero with integer arithmetic', () => {
    const base = () => {
      const value = load();
      value.package.price.basis = 'per_group';
      value.package.mandatoryFees = [];
      for (const extra of value.quotes.extras) extra.mirrorsPackageInclusion = false;
      value.quotes.transport[0]!.unit = 'group';
      value.quotes.transport[0]!.unitMinor = 10000;
      value.quotes.lodging[0]!.unit = 'room_stay';
      value.quotes.lodging[0]!.unitMinor = 10000;
      return value;
    };
    const ratio = (amountMinor: number) => {
      const value = base();
      value.package.price.amountMinor = amountMinor;
      const row = scenario(run(value), 'bus:with_breakfast');
      expect(row.unbundledTotalMinor).toBe(20000);
      return row.deltaBasisPoints;
    };
    expect(ratio(20001)).toBe(1);
    expect(ratio(19999)).toBe(-1);
    expect(ratio(20003)).toBe(2);
    expect(ratio(19997)).toBe(-2);
  });

  it('is deterministic for shuffled arrays and breaks price ties by ASCII id', () => {
    const ordered = load();
    ordered.package.warnings = ['LODGING_MAY_CHANGE', 'YEAR_NOT_STATED'];
    ordered.package.mandatoryFees.push({
      label: 'Synthetic service fee',
      amountMinor: 5000,
      basis: 'per_group',
      payment: 'in_package',
    });
    ordered.quotes.transport.push(
      { ...ordered.quotes.transport[0]!, id: 'bus-z', sourceIds: ['src-bus'] },
      { ...ordered.quotes.transport[0]!, id: 'bus-a', sourceIds: ['src-bus'] },
    );
    const shuffled = structuredClone(ordered);
    shuffled.sources.reverse();
    shuffled.quotes.transport.reverse();
    shuffled.quotes.lodging.reverse();
    shuffled.quotes.extras.reverse();
    shuffled.package.mandatoryFees.reverse();
    shuffled.package.warnings.reverse();
    const { calculationReceipt: first, ...a } = run(ordered);
    const { calculationReceipt: second, ...b } = run(shuffled);
    expect(b).toEqual(a);
    expect(second.outputSha256).toBe(first.outputSha256);
    // The receipt still binds the exact input that was supplied.
    expect(second.inputSha256).not.toBe(first.inputSha256);
    expect(scenario(run(ordered), 'bus:with_breakfast').chosen.transportIds).toEqual(['bus-a']);
    expect(JSON.stringify(run(ordered))).toBe(JSON.stringify(run(structuredClone(ordered))));
  });

  it('rejects unsafe integer results with a stable code', () => {
    const value = load();
    value.package.price.amountMinor = Number.MAX_SAFE_INTEGER;
    expect(() => run(value)).toThrow('INTELLIGENCE_INTEGER_OVERFLOW');
    const quote = load();
    quote.quotes.transport[0]!.unitMinor = Number.MAX_SAFE_INTEGER;
    expect(() => run(quote)).toThrow('INTELLIGENCE_INTEGER_OVERFLOW');
  });

  it('rejects extra fields, unsafe sources and duplicate identifiers', () => {
    expect(() => run({ ...load(), executeImportedInstruction: true })).toThrow(
      'INVALID_PLANNING_INPUT',
    );
    expect(() => packageArbitrage({ ...load(), discountMinor: 1 })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    const nested = load();
    (nested.quotes.transport[0] as unknown as Record<string, unknown>).discountMinor = 100;
    expect(() => run(nested)).toThrow('INVALID_PLANNING_INPUT');
    const observation = load();
    (observation.package as unknown as Record<string, unknown>).contact = 'synthetic';
    expect(() => run(observation)).toThrow('INVALID_PLANNING_INPUT');
    const insecure = load();
    insecure.sources[0]!.url = 'http://bus.example.invalid/synthetic';
    expect(() => run(insecure)).toThrow('INVALID_PLANNING_INPUT');
    const duplicateSource = load();
    duplicateSource.sources.push({ ...duplicateSource.sources[0]! });
    expect(() => run(duplicateSource)).toThrow('PACKAGE_ARBITRAGE_DUPLICATE_ID');
    const duplicateQuote = load();
    duplicateQuote.quotes.extras[0]!.id = 'bus-rt';
    expect(() => run(duplicateQuote)).toThrow('PACKAGE_ARBITRAGE_DUPLICATE_ID');
  });
});
