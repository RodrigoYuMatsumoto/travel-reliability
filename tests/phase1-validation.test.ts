import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { demoTrip } from '../api/src/demo.js';
import { AppError } from '../api/src/errors.js';
import { literalFacts } from '../api/src/literal-facts.js';
import { assertIanaTimeZone, instant, validateTrip } from '../api/src/validation.js';
import { ISO_4217_SOURCE, currencyMinorUnits, isActiveCurrency } from '../schema/src/currency.js';
import type { BundledTour, Service } from '../schema/src/trip-contract.js';
import { formatMinor } from '../web/src/format-money.js';

/** Runs `action` and returns the AppError it throws, failing when it does not throw one. */
function appError(action: () => unknown): AppError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('expected an AppError');
}
function flight(trip: ReturnType<typeof demoTrip>): Service {
  return trip.services.find((s) => s.id === 'flight-a')!;
}
function syntheticTour(currency: string): BundledTour {
  return {
    id: 'synthetic-tour',
    provider: 'Synthetic Agency',
    sourceUrl: null,
    observedAt: '2026-10-01T12:00:00Z',
    observationSha256: null,
    price: { amountMinor: 100000, currency, basis: 'per_person', qualifier: 'exact' },
    comparison: {
      status: 'not_compared',
      calculator: 'package-arbitrage',
      evaluatedAt: null,
      classification: null,
      packageTotalMinor: null,
      unbundledTotalMinor: null,
      deltaMinor: null,
      receiptSha256: null,
    },
  };
}

describe('A1-03: ISO 4217 table', () => {
  it('records the official source and its publication date', () => {
    expect(ISO_4217_SOURCE.url).toMatch(/^https:\/\/www\.six-group\.com\//);
    expect(ISO_4217_SOURCE.published).toBe('2026-09-17');
    expect(ISO_4217_SOURCE.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it('returns ISO minor units for listed currencies', () => {
    expect(currencyMinorUnits('BRL')).toBe(2);
    expect(currencyMinorUnits('JPY')).toBe(0);
    expect(currencyMinorUnits('IQD')).toBe(3);
    expect(currencyMinorUnits('CLF')).toBe(4);
    expect(isActiveCurrency('USD')).toBe(true);
  });
  it('lists codes without minor units but gives them no scale', () => {
    for (const code of ['XAU', 'XDR', 'XXX', 'XTS']) {
      expect(isActiveCurrency(code)).toBe(true);
      expect(currencyMinorUnits(code)).toBeNull();
    }
  });
  it('rejects unknown, lower-case and prototype-key lookups', () => {
    for (const code of ['ZZZ', 'brl', 'BRL ', '', '__proto__', 'constructor', 'toString']) {
      expect(isActiveCurrency(code)).toBe(false);
      expect(currencyMinorUnits(code)).toBeNull();
    }
    expect(isActiveCurrency(null as unknown as string)).toBe(false);
  });
});

describe('A1-03: unknown currency fails the Trip Contract with 422', () => {
  it('accepts listed currencies in the trip, service prices and bundled tours', () => {
    const trip = demoTrip();
    flight(trip).price!.currency = 'USD';
    trip.bundledTours = [syntheticTour('BRL')];
    expect(() => validateTrip(trip)).not.toThrow();
  });
  it('rejects an unknown trip currency', () => {
    const error = appError(() => validateTrip({ ...demoTrip(), currency: 'ZZZ' }));
    expect([error.code, error.status, error.details]).toEqual([
      'UNKNOWN_CURRENCY',
      422,
      { path: '/currency' },
    ]);
  });
  it('rejects an unknown service price currency and points at it', () => {
    const trip = demoTrip(),
      index = trip.services.findIndex((s) => s.id === 'flight-a');
    flight(trip).price!.currency = 'ZZZ';
    const error = appError(() => validateTrip(trip));
    expect([error.code, error.status, error.details]).toEqual([
      'UNKNOWN_CURRENCY',
      422,
      { path: `/services/${index}/price/currency` },
    ]);
  });
  it('rejects an unknown bundled tour currency', () => {
    const trip = demoTrip();
    trip.bundledTours = [syntheticTour('BRL'), syntheticTour('ZZZ')];
    const error = appError(() => validateTrip(trip));
    expect([error.code, error.details]).toEqual([
      'UNKNOWN_CURRENCY',
      { path: '/bundledTours/1/price/currency' },
    ]);
  });
  it('rejects listed codes that cannot carry minor units', () => {
    const trip = demoTrip();
    flight(trip).price!.currency = 'XAU';
    const error = appError(() => validateTrip(trip));
    expect([error.code, error.status]).toEqual(['CURRENCY_WITHOUT_MINOR_UNITS', 422]);
    expect(appError(() => validateTrip({ ...demoTrip(), currency: 'XXX' })).code).toBe(
      'CURRENCY_WITHOUT_MINOR_UNITS',
    );
  });
});

describe('A1-03: display uses ISO minor units, not CLDR digits', () => {
  it('keeps the existing exact formatting for common currencies', () => {
    expect(formatMinor(123456, 'BRL', 'pt-BR')).toContain('1.234,56');
    expect(formatMinor(1234, 'JPY', 'en')).toContain('1,234');
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'BRL', 'pt-BR')).toContain(',91');
  });
  it('places the decimal separator where ISO puts it when CLDR disagrees', () => {
    // CLDR shows IQD and HUF with no decimals; ISO 4217 gives them 3 and 2.
    expect(formatMinor(1234, 'IQD', 'en')).toContain('1.234');
    expect(formatMinor(1234, 'IQD', 'en')).not.toContain('1,234');
    expect(formatMinor(12345, 'HUF', 'en')).toContain('123.45');
  });
  it('keeps sign and leading zeros for small negative amounts and four-place units', () => {
    const iqd = formatMinor(-5, 'IQD', 'en');
    expect(iqd).toContain('0.005');
    expect(iqd).toContain('-');
    expect(formatMinor(10001, 'CLF', 'en')).toContain('1.0001');
  });
  it('refuses to guess a scale for unknown or unit-less codes', () => {
    // Reuse the placeholder the function already returns for a non-integer amount.
    const unavailable = formatMinor(1.5, 'BRL', 'pt-BR');
    expect(unavailable).not.toMatch(/\d/);
    expect(formatMinor(100, 'ZZZ', 'en')).toBe(unavailable);
    expect(formatMinor(100, 'XAU', 'en')).toBe(unavailable);
    expect(formatMinor(100, 'brl', 'pt-BR')).toBe(unavailable);
  });
});

describe('A1-03: literal extraction uses the ISO table', () => {
  const money = (line: string) =>
    literalFacts(line)
      .filter((f) => f.kind === 'money')
      .map((f) => f.value);
  it('extracts currencies outside the former 11-currency table', () => {
    expect(money('Total: CHF 10.50')).toEqual([{ currency: 'CHF', minorUnits: 1050 }]);
    expect(money('Total: IQD 1.234')).toEqual([{ currency: 'IQD', minorUnits: 1234 }]);
  });
  it('keeps BRL and zero-decimal parsing unchanged', () => {
    expect(money('Valor total: R$ 1.234,56')).toEqual([{ currency: 'BRL', minorUnits: 123456 }]);
    expect(money('Total: JPY 1500')).toEqual([{ currency: 'JPY', minorUnits: 1500 }]);
    expect(money('Total: JPY 15.00')).toEqual([]);
  });
  it('requires the exact ISO number of decimals', () => {
    expect(money('Total: IQD 1.23')).toEqual([]);
    expect(money('Total: USD 1.234')).toEqual([]);
  });
  it('leaves unknown and unit-less codes unparsed', () => {
    expect(money('Total: ZZZ 10.00')).toEqual([]);
    expect(money('Total: XAU 10')).toEqual([]);
    expect(money('Total: XXX 10')).toEqual([]);
  });
});

describe('A1-01: chronology without time zones', () => {
  function service(start: string | null, end: string | null, local = ['T10:00', 'T09:00']) {
    const trip = demoTrip(),
      target = flight(trip),
      day = target.start.local.slice(0, 10);
    target.start = { local: day + local[0], timeZone: start };
    target.end = { local: day + local[1], timeZone: end };
    return trip;
  }
  it('accepts services whose zone-less end is not before the start', () => {
    expect(() => validateTrip(service(null, null, ['T09:00', 'T10:00']))).not.toThrow();
    expect(() => validateTrip(service(null, null, ['T09:00', 'T09:00']))).not.toThrow();
  });
  it('rejects a zone-less service that ends before it starts', () => {
    const error = appError(() => validateTrip(service(null, null)));
    expect([error.code, error.status]).toEqual(['SERVICE_END_BEFORE_START', 422]);
  });
  it('rejects a service with only one known zone, in either position', () => {
    for (const trip of [
      service('America/Sao_Paulo', null, ['T09:00', 'T10:00']),
      service(null, 'America/Sao_Paulo', ['T09:00', 'T10:00']),
    ]) {
      const error = appError(() => validateTrip(trip));
      expect([error.code, error.status]).toEqual(['SERVICE_TIME_ZONE_INCOMPLETE', 422]);
    }
  });
  it('keeps comparing instants when both zones are known', () => {
    // 10:00 in Sao Paulo is 13:00Z; 09:30 in Manaus is 13:30Z: later despite the local clock.
    expect(() =>
      validateTrip(service('America/Sao_Paulo', 'America/Manaus', ['T10:00', 'T09:30'])),
    ).not.toThrow();
    // 09:00 in Manaus is 13:00Z; 09:30 in Noronha is 11:30Z: earlier despite the local clock.
    const error = appError(() =>
      validateTrip(service('America/Manaus', 'America/Noronha', ['T09:00', 'T09:30'])),
    );
    expect(error.code).toBe('SERVICE_END_BEFORE_START');
  });
});

describe('A1-02: strict IANA time zones', () => {
  it('accepts tz database names, including links and signed Etc names', () => {
    for (const zone of ['America/Sao_Paulo', 'America/Argentina/Buenos_Aires', 'UTC', 'Etc/GMT+3'])
      expect(assertIanaTimeZone(zone)).toBe(zone);
  });
  it('rejects offsets and offset-like names with 422', () => {
    for (const zone of ['+03:00', '-0500', '+03', 'UTC+3', 'GMT-3', 'Z']) {
      const error = appError(() => assertIanaTimeZone(zone));
      expect([error.code, error.status]).toEqual(['INVALID_TIME_ZONE', 422]);
    }
  });
  it('rejects nonexistent zones, blank values and non-normalized spelling', () => {
    for (const zone of [
      'Mars/Olympus',
      'America/Atlantis',
      '',
      ' America/Sao_Paulo',
      'america/sao_paulo',
    ])
      expect(appError(() => assertIanaTimeZone(zone)).code).toBe('INVALID_TIME_ZONE');
  });
  it('rejects date-time strings that Temporal would read as a zone', () => {
    for (const zone of [
      '2026-01-01T00:00[America/Sao_Paulo]',
      '2026-01-01T00:00Z',
      '2026-01-01T00:00+03:00',
    ])
      expect(appError(() => instant({ local: '2026-01-01T12:00', timeZone: zone })).code).toBe(
        'INVALID_TIME_ZONE',
      );
  });
  it('fails the Trip Contract with 422 for an offset zone', () => {
    const trip = demoTrip();
    flight(trip).start.timeZone = '+03:00';
    const error = appError(() => validateTrip(trip));
    expect([error.code, error.status]).toEqual(['INVALID_TIME_ZONE', 422]);
  });
  it('keeps rejecting daylight-saving gaps and overlaps, now with 422', () => {
    for (const local of ['2026-03-08T02:30', '2026-11-01T01:30']) {
      const error = appError(() => instant({ local, timeZone: 'America/New_York' }));
      expect([error.code, error.status]).toEqual(['INVALID_OR_AMBIGUOUS_LOCAL_TIME', 422]);
    }
    expect(instant({ local: '2026-11-01T03:30', timeZone: 'America/New_York' })).toBe(
      Date.parse('2026-11-01T08:30:00Z'),
    );
    expect(instant({ local: '2026-01-01T12:00', timeZone: null })).toBeNull();
  });
});

describe('A1-02 and A1-03 over HTTP', () => {
  const running: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((context) => context.app.close()));
  });
  it('answers 422 with stable codes for an offset zone and an unknown currency', async () => {
    const context = await buildApp(loadConfig({ APP_MODE: 'demo' }));
    running.push(context);
    await context.app.ready();
    const login = await context.app.inject({
      method: 'POST',
      url: '/auth/demo',
      headers: { origin: 'http://127.0.0.1:4310' },
    });
    const headers = {
      cookie: 'tr_session=' + login.cookies.find((c) => c.name === 'tr_session')!.value,
      origin: 'http://127.0.0.1:4310',
      'x-csrf-token': (login.json() as { csrf: string }).csrf,
    };
    const offsetZone = demoTrip();
    flight(offsetZone).end.timeZone = '-0500';
    for (const [body, code] of [
      [offsetZone, 'INVALID_TIME_ZONE'],
      [{ ...demoTrip(), currency: 'ZZZ' }, 'UNKNOWN_CURRENCY'],
    ] as const) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/v1/trips',
        headers,
        payload: body,
      });
      expect(response.statusCode).toBe(422);
      expect((response.json() as { error: { code: string } }).error.code).toBe(code);
    }
  });
});
