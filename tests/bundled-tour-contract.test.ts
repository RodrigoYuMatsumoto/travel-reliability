import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateTrip } from '../api/src/validation.js';
import { lodgingDraftDates } from '../web/src/lodging-draft.js';

const base = () =>
  JSON.parse(readFileSync(new URL('../examples/trip-contract.json', import.meta.url), 'utf8'));

const tour = (overrides: Record<string, unknown> = {}) => ({
  id: 'tour-1',
  provider: 'Agência Sintética',
  sourceUrl: 'https://agencia.example.invalid/pacote/1',
  observedAt: '2026-11-04T09:00:00-03:00',
  observationSha256: 'a'.repeat(64),
  price: { amountMinor: 129900, currency: 'BRL', basis: 'per_person', qualifier: 'exact' },
  comparison: {
    status: 'final',
    calculator: 'package-arbitrage',
    evaluatedAt: '2026-11-04T10:00:00-03:00',
    classification: 'agency_premium',
    packageTotalMinor: 259800,
    unbundledTotalMinor: 240000,
    deltaMinor: 19800,
    receiptSha256: 'b'.repeat(64),
  },
  ...overrides,
});

const code = (action: () => unknown) => {
  try {
    action();
    return 'OK';
  } catch (error) {
    return (error as { code?: string }).code;
  }
};

describe('bundled tours in the Trip Contract', () => {
  it('accepts a contract without bundled tours and one with a tagged service', () => {
    expect(code(() => validateTrip(base()))).toBe('OK');
    const trip = base();
    trip.bundledTours = [tour()];
    trip.services[0].bundle = { tourId: 'tour-1', role: 'transport' };
    expect(code(() => validateTrip(trip))).toBe('OK');
  });

  it('rejects a service tag that points to a missing tour and duplicate tour ids', () => {
    const missing = base();
    missing.services[0].bundle = { tourId: 'tour-9', role: 'lodging' };
    expect(code(() => validateTrip(missing))).toBe('UNKNOWN_BUNDLED_TOUR');
    const duplicate = base();
    duplicate.bundledTours = [tour(), tour()];
    expect(code(() => validateTrip(duplicate))).toBe('DUPLICATE_BUNDLED_TOUR_ID');
  });

  it('keeps the stored comparison arithmetically consistent', () => {
    const wrongDelta = base();
    wrongDelta.bundledTours = [tour({ comparison: { ...tour().comparison, deltaMinor: 100 } })];
    expect(code(() => validateTrip(wrongDelta))).toBe('BUNDLED_TOUR_COMPARISON_INCONSISTENT');
    const wrongLabel = base();
    wrongLabel.bundledTours = [
      tour({ comparison: { ...tour().comparison, classification: 'agency_discount' } }),
    ];
    expect(code(() => validateTrip(wrongLabel))).toBe('BUNDLED_TOUR_COMPARISON_INCONSISTENT');
    const discount = base();
    discount.bundledTours = [
      tour({
        comparison: {
          ...tour().comparison,
          classification: 'agency_discount',
          unbundledTotalMinor: 300000,
          deltaMinor: -40200,
        },
      }),
    ];
    expect(code(() => validateTrip(discount))).toBe('OK');
  });

  it('requires an empty comparison when the tour was not compared', () => {
    const empty = {
      status: 'not_compared',
      calculator: 'package-arbitrage',
      evaluatedAt: null,
      classification: null,
      packageTotalMinor: null,
      unbundledTotalMinor: null,
      deltaMinor: null,
      receiptSha256: null,
    };
    const trip = base();
    trip.bundledTours = [tour({ comparison: empty })];
    expect(code(() => validateTrip(trip))).toBe('OK');
    trip.bundledTours = [tour({ comparison: { ...empty, classification: 'parity' } })];
    expect(code(() => validateTrip(trip))).toBe('BUNDLED_TOUR_COMPARISON_INCONSISTENT');
  });

  it('requires receipt, date and totals before a comparison is stored as final', () => {
    const variants: Array<Record<string, unknown>> = [
      { receiptSha256: null },
      { evaluatedAt: null },
      { evaluatedAt: '2026-11-04T08:00:00-03:00' },
      { packageTotalMinor: null, unbundledTotalMinor: null, deltaMinor: null },
      {
        classification: 'not_computable',
        packageTotalMinor: null,
        unbundledTotalMinor: null,
        deltaMinor: null,
      },
      { unbundledTotalMinor: null },
    ];
    for (const change of variants) {
      const trip = base();
      trip.bundledTours = [tour({ comparison: { ...tour().comparison, ...change } })];
      expect(
        code(() => validateTrip(trip)),
        JSON.stringify(change),
      ).toBe('BUNDLED_TOUR_COMPARISON_INCONSISTENT');
    }
    const pending = base();
    pending.bundledTours = [
      tour({
        comparison: {
          ...tour().comparison,
          status: 'pending',
          classification: 'not_computable',
          packageTotalMinor: null,
          unbundledTotalMinor: null,
          deltaMinor: null,
        },
      }),
    ];
    expect(code(() => validateTrip(pending))).toBe('OK');
  });

  it('rejects unknown properties, non-https sources and unknown currencies', () => {
    const extra = base();
    extra.bundledTours = [tour({ bookingConfirmed: true })];
    expect(code(() => validateTrip(extra))).not.toBe('OK');
    const http = base();
    http.bundledTours = [tour({ sourceUrl: 'http://agencia.example.invalid/1' })];
    expect(code(() => validateTrip(http))).not.toBe('OK');
    const currency = base();
    currency.bundledTours = [tour({ price: { ...tour().price, currency: 'ZZZ' } })];
    expect(code(() => validateTrip(currency))).toBe('UNKNOWN_CURRENCY');
  });
});

describe('lodging draft dates', () => {
  it('keeps multi-day trips and gives same-day trips a next-day check-out', () => {
    expect(lodgingDraftDates({ startDate: '2026-12-23', endDate: '2026-12-27' })).toEqual({
      checkIn: '2026-12-23',
      checkOut: '2026-12-27',
    });
    expect(lodgingDraftDates({ startDate: '2026-12-31', endDate: '2026-12-31' })).toEqual({
      checkIn: '2026-12-31',
      checkOut: '2027-01-01',
    });
    expect(lodgingDraftDates(undefined)).toEqual({
      checkIn: '2030-01-01',
      checkOut: '2030-01-02',
    });
  });
});
