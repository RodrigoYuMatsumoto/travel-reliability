import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { fetchObservation, normalizeObservation } from '../agent/trip-observations.js';
import { reviewTripUpdate } from '../agent/trip-update.js';

const route = { kind: 'route', sourceId: 'S1', factPrefix: 'travel', from: [2, 40], to: [3, 40] };
const now = '2031-02-11T09:00:00Z';
const routeBody = { code: 'Ok', routes: [{ duration: 1570, distance: 29623 }] };
const forecast = {
  kind: 'forecast',
  sourceId: 'S2',
  factPrefix: 'thermal',
  at: [3, 40],
  day: '2031-02-12',
  timeZone: 'Europe/Madrid',
};
const units = {
  time: 'iso8601',
  temperature_2m_min: '°C',
  temperature_2m_max: '°C',
  precipitation_probability_max: '%',
};
const daily = {
  time: [forecast.day],
  temperature_2m_min: [2],
  temperature_2m_max: [9],
  precipitation_probability_max: [null],
};

describe('optional sources with synthetic responses', () => {
  it('rejects a live CLI request without explicit network authorization before opening its input', () => {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'scripts/trip-observation.ts', 'fetch', 'missing.json'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('OBSERVATION_NETWORK_NOT_AUTHORIZED');
    expect(result.stdout).toBe('');
  });

  it('binds route facts to a dated source and stops using expired travel time', () => {
    const result = normalizeObservation(route, routeBody, now);
    const sourceIds = ['S1'];
    const input = {
      tripKey: 'demo',
      at: now,
      sources: [result.source],
      tasks: [],
      facts: [
        ...result.facts,
        { id: 'end', value: '2031-02-12T10:30:00+01:00', sourceIds },
        { id: 'start', value: '2031-02-12T11:00:00+01:00', sourceIds },
      ],
      calculations: [
        {
          id: 'gap',
          fromFact: 'end',
          toFact: 'start',
          minimumMinutes: 10,
          routeMinutesFact: 'travel-minutes',
        },
      ],
    };
    expect(result.basis).toBe('road_model_no_live_traffic');
    expect(reviewTripUpdate(input).calculations[0]).toMatchObject({
      requiredMinutes: 37,
      remainingMinutes: -7,
      state: 'short',
    });
    expect(
      reviewTripUpdate({ ...input, at: result.source.expiresAt }).calculations[0],
    ).toMatchObject({ state: 'unverified', requiredMinutes: null });
  });

  it('leaves unavailable forecast values unknown and requires the selected date and zone', () => {
    const response = { timezone: 'Europe/Madrid', daily_units: units, daily };
    expect(normalizeObservation(forecast, response, now).facts).toContainEqual({
      id: 'thermal-rain-pct',
      value: null,
      sourceIds: ['S2'],
    });
    expect(() => normalizeObservation(forecast, { ...response, timezone: 'UTC' }, now)).toThrow(
      'FORECAST_SCOPE_MISMATCH',
    );
    expect(() =>
      normalizeObservation(
        forecast,
        { ...response, daily: { ...daily, time: ['2031-02-13'] } },
        now,
      ),
    ).toThrow('FORECAST_SCOPE_MISMATCH');
  });

  it('uses a fixed read endpoint and propagates unavailability without substitution', async () => {
    const http = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(routeBody))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    await expect(fetchObservation(route, http, () => new Date(now))).resolves.toMatchObject({
      source: { kind: 'route' },
    });
    expect((http.mock.calls[0]![0] as URL).hostname).toBe('router.project-osrm.org');
    expect(http.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      credentials: 'omit',
      redirect: 'error',
    });
    await expect(fetchObservation(route, http)).rejects.toThrow('OBSERVATION_UNAVAILABLE');
  });
});
