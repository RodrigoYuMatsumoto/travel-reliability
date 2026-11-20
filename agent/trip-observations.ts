import { z } from 'zod';
import { updateDigest, type TripUpdateInput } from './trip-update.js';

const coordinates = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,45}$/);
const routeRequest = z.strictObject({
  kind: z.literal('route'),
  sourceId: id,
  factPrefix: id,
  from: coordinates,
  to: coordinates,
});
const forecastRequest = z.strictObject({
  kind: z.literal('forecast'),
  sourceId: id,
  factPrefix: id,
  at: coordinates,
  day: z.iso.date(),
  timeZone: z.string().min(1).max(64),
});
const requestSchema = z.discriminatedUnion('kind', [routeRequest, forecastRequest]);
const routes = z.object({
  code: z.literal('Ok'),
  routes: z
    .array(
      z.object({
        duration: z.number().min(0).max(604800),
        distance: z.number().min(0).max(20000000),
      }),
    )
    .min(1)
    .max(3),
});
const forecast = z.object({
  timezone: z.string(),
  daily_units: z.object({
    time: z.literal('iso8601'),
    temperature_2m_min: z.literal('°C'),
    temperature_2m_max: z.literal('°C'),
    precipitation_probability_max: z.literal('%'),
  }),
  daily: z.object({
    time: z.array(z.iso.date()).length(1),
    temperature_2m_min: z.array(z.number().min(-100).max(80).nullable()).length(1),
    temperature_2m_max: z.array(z.number().min(-100).max(80).nullable()).length(1),
    precipitation_probability_max: z.array(z.number().int().min(0).max(100).nullable()).length(1),
  }),
});

export function observationUrl(raw: unknown): URL {
  const request = requestSchema.parse(raw);
  if (request.kind === 'route') {
    const endpoints = [request.from, request.to].map((point) =>
      point.map((value) => value.toFixed(5)).join(','),
    );
    return new URL(
      'https://router.project-osrm.org/route/v1/driving/' +
        endpoints.join(';') +
        '?overview=false&steps=false&alternatives=false',
    );
  }
  // Reject unknown zones before contacting a provider.
  new Intl.DateTimeFormat('en', { timeZone: request.timeZone });
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  const [longitude, latitude] = request.at;
  url.search = new URLSearchParams({
    latitude: latitude.toFixed(5),
    longitude: longitude.toFixed(5),
    timezone: request.timeZone,
    start_date: request.day,
    end_date: request.day,
    daily: 'temperature_2m_min,temperature_2m_max,precipitation_probability_max',
  }).toString();
  return url;
}

export function normalizeObservation(raw: unknown, body: unknown, observedAt: string) {
  const request = requestSchema.parse(raw);
  const clock = z.iso.datetime({ offset: true }).parse(observedAt);
  const millis = Date.parse(clock);
  const source: TripUpdateInput['sources'][number] = {
    id: request.sourceId,
    kind: request.kind,
    origin: request.kind === 'route' ? 'osrm' : 'open-meteo',
    digest: updateDigest({ request, body }),
    observedAt: new Date(millis).toISOString(),
    expiresAt: new Date(millis + (request.kind === 'route' ? 24 : 6) * 3600000).toISOString(),
  };
  const fact = (suffix: string, value: TripUpdateInput['facts'][number]['value']) => ({
    id: request.factPrefix + '-' + suffix,
    value,
    sourceIds: [source.id],
  });
  if (request.kind === 'route') {
    const result = routes.parse(body).routes[0]!;
    return {
      source,
      facts: [
        fact('minutes', Math.ceil(result.duration / 60)),
        fact('meters', Math.ceil(result.distance)),
      ],
      basis: 'road_model_no_live_traffic',
    };
  }
  const result = forecast.parse(body);
  const expected = new Intl.DateTimeFormat('en', { timeZone: request.timeZone }).resolvedOptions()
    .timeZone;
  const actual = new Intl.DateTimeFormat('en', { timeZone: result.timezone }).resolvedOptions()
    .timeZone;
  if (actual !== expected || result.daily.time[0] !== request.day)
    throw new Error('FORECAST_SCOPE_MISMATCH');
  const min = result.daily.temperature_2m_min[0] ?? null;
  const max = result.daily.temperature_2m_max[0] ?? null;
  if (min !== null && max !== null && min > max) throw new Error('FORECAST_RANGE_INVALID');
  return {
    source,
    facts: [
      fact('day', request.day),
      fact('min-c', min),
      fact('max-c', max),
      fact('rain-pct', result.daily.precipitation_probability_max[0] ?? null),
    ],
    basis: 'forecast_model_not_official_warning',
  };
}

export async function fetchObservation(
  raw: unknown,
  http: typeof fetch = fetch,
  now = () => new Date(),
) {
  const url = observationUrl(raw);
  const response = await http(url, {
    method: 'GET',
    redirect: 'error',
    credentials: 'omit',
    signal: AbortSignal.timeout(8000),
    headers: { Accept: 'application/json' },
  });
  if (!response.ok || !response.body) throw new Error('OBSERVATION_UNAVAILABLE');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 262144) {
        await reader.cancel();
        throw new Error('OBSERVATION_RESPONSE_LIMIT');
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
  );
  return normalizeObservation(raw, body, now().toISOString());
}
