import { describe, expect, it } from 'vitest';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { discoverPackages } from '../agent/package-discovery.js';
import { groundTransport } from '../api/src/ground-transport.js';
import { createPackageComparisonDraft } from '../web/src/package-comparison-draft.js';

const query = () => ({
  origin: 'Petrolina, PE',
  destination: null,
  windows: [
    { id: 'christmas', startDate: '2026-12-24', endDate: '2026-12-27' },
    { id: 'new-year', startDate: '2026-12-30', endDate: '2027-01-03' },
  ],
  limit: 20,
});

describe('public package discovery integration', () => {
  it('prepares five unpriced alternatives without presenting a reference link as a quote', () => {
    const input = query();
    const source = discoverPackages(input).items.find((row) => row.kind === 'package')!;
    const draft = createPackageComparisonDraft(input, source, 0, 'America/Recife');
    expect(draft.offers).toHaveLength(5);
    expect(draft.travelerProfile.adults).toBeNull();
    expect(draft.travelerProfile.children).toBeNull();
    expect(draft.travelerProfile.budgetMinor).toBeNull();
    expect(draft.sources[0]!.status).toBe('declared');
    expect(
      draft.offers.every((offer) => offer.costs.every((cost) => cost.unitMinor === null)),
    ).toBe(true);
    const rows = groundTransport(draft).rows;
    expect(
      rows.every((row) => row.finalTotalMinor === null && row.difference.savingsMinor === null),
    ).toBe(true);
    expect(rows.filter((row) => row.transportMode === 'flight')).toHaveLength(2);
    expect(
      createPackageComparisonDraft(input, source, 1, 'America/Recife').requestedWindow
        .latestReturnAt,
    ).toContain('2027-01-03');
  });

  it('rejects an unsafe link instead of turning it into a draft source', () => {
    const source = discoverPackages(query()).items[0]!;
    expect(() =>
      createPackageComparisonDraft(
        query(),
        { ...source, browserUrl: 'javascript:alert(1)' },
        0,
        'America/Recife',
      ),
    ).toThrow('PACKAGE_SOURCE_URL_REJECTED');
  });

  it('binds an explicitly selected second period without reusing the first period or inferring prices', () => {
    const input = query();
    const source = discoverPackages(input).items.find((row) => row.kind === 'package')!;
    const draft = createPackageComparisonDraft(input, source, 1, 'America/Recife');
    expect(draft.requestedWindow.earliestDepartureAt).toBe('2026-12-30T00:00:00-03:00');
    expect(draft.requestedWindow.latestReturnAt).toBe('2027-01-03T23:59:59-03:00');
    expect(
      draft.offers.every((offer) => offer.costs.every((cost) => cost.unitMinor === null)),
    ).toBe(true);
    for (const index of [-1, 0.5, 2])
      expect(() => createPackageComparisonDraft(input, source, index, 'America/Recife')).toThrow(
        'PACKAGE_WINDOW_REQUIRED',
      );
  });

  it('uses the explicitly supplied origin IANA zone rather than inferring a Brazilian zone from a reference', () => {
    const input = { ...query(), origin: 'Los Angeles' };
    const source = discoverPackages(input).items.find((row) => row.kind === 'package')!;
    const local = createPackageComparisonDraft(input, source, 0, 'America/Los_Angeles');
    const regional = createPackageComparisonDraft(input, source, 0, 'America/Recife');
    expect(local.requestedWindow.timeZone).toBe('America/Los_Angeles');
    expect(local.requestedWindow.earliestDepartureAt).toBe('2026-12-24T00:00:00-08:00');
    expect(
      Date.parse(local.requestedWindow.earliestDepartureAt) -
        Date.parse(regional.requestedWindow.earliestDepartureAt),
    ).toBe(5 * 3600000);
    for (const invalid of ['', 'Invalid/Unknown', '+01:00', undefined])
      expect(() => createPackageComparisonDraft(input, source, 0, invalid as string)).toThrow(
        'PACKAGE_TIME_ZONE_',
      );
  });

  it('exposes schema and requires a session and CSRF for the offline search endpoint', async () => {
    const { app } = await buildApp(loadConfig({ APP_MODE: 'demo' }));
    try {
      const schema = await app.inject({ method: 'GET', url: '/schema/package-discovery.json' });
      expect(schema.statusCode).toBe(200);
      expect(schema.json().$schema).toContain('2020-12');
      expect(
        (await app.inject({ method: 'POST', url: '/v1/package-discovery', payload: query() }))
          .statusCode,
      ).toBe(401);
      const login = await app.inject({
        method: 'POST',
        url: '/auth/demo',
        headers: { origin: 'http://127.0.0.1:4310' },
        payload: {},
      });
      expect(login.statusCode).toBe(200);
      const cookie = login.cookies.map((value) => value.name + '=' + value.value).join('; ');
      const bad = await app.inject({
        method: 'POST',
        url: '/v1/package-discovery',
        headers: { cookie, origin: 'http://127.0.0.1:4310' },
        payload: query(),
      });
      expect(bad.statusCode).toBe(403);
      const good = await app.inject({
        method: 'POST',
        url: '/v1/package-discovery',
        headers: { cookie, origin: 'http://127.0.0.1:4310', 'x-csrf-token': login.json().csrf },
        payload: query(),
      });
      expect(good.statusCode).toBe(200);
      expect(good.json()).toMatchObject({
        kind: 'package_discovery_plan',
        externalCalls: 0,
        factsVerified: false,
      });
      expect(good.json().windows).toHaveLength(2);
    } finally {
      await app.close();
    }
  });
});
