import { lookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { types } from 'node:util';
import { gunzipSync } from 'node:zlib';

export const publicSourceCatalog = [
  {
    id: 'ibge-municipality',
    mode: 'opt_in_live',
    documentation: 'https://servicodados.ibge.gov.br/api/docs/localidades',
    requires: ['municipalityId', 'networkApproval'],
    limits: 'Administrative identity only; no supplier or reservation verification.',
  },
  {
    id: 'open-meteo',
    mode: 'opt_in_live',
    documentation: 'https://open-meteo.com/en/docs',
    terms: 'https://open-meteo.com/en/terms',
    requires: ['coordinates', 'networkApproval', 'nonCommercialAcknowledgement'],
    limits:
      'Forecast, not a safety guarantee. Free endpoint is non-commercial; attribution required.',
  },
  {
    id: 'cadastur',
    mode: 'official_assisted_or_licensed_adapter',
    documentation:
      'https://www.gov.br/conecta/catalogo/apis/cadastur-cadastro-de-prestadores-de-servicos-turisticos/',
    requires: ['official result with verification date or authorized API agreement'],
    limits:
      'Conecta access is not a universal public API credential. Do not scrape accounts or bulk personal records.',
  },
  {
    id: 'anac-vra',
    mode: 'historical_dataset',
    documentation:
      'https://www.anac.gov.br/acesso-a-informacao/dados-abertos/areas-de-atuacao/voos-e-operacoes-aereas/voo-regular-ativo-vra',
    requires: ['dated official dataset'],
    limits: 'Historical records are not live flight status, fares or inventory.',
  },
  {
    id: 'supplier-status',
    mode: 'authorized_adapter_or_assisted_snapshot',
    documentation:
      'https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/main/docs/CONNECTORS.md',
    requires: ['operator-reviewed provider adapter or explicit traveler-supplied update'],
    limits:
      'Use the existing disruption event and reconciliation contracts. No undocumented supplier endpoint or automatic purchase.',
  },
  {
    id: 'claims-and-reviews',
    mode: 'reviewable_export',
    documentation:
      'https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/main/docs/OPERATIONS.md',
    requires: ['evidence and traveler review'],
    limits:
      'Factual dossier export, private structured reviews and discrepancies. No automatic complaint submission or identity/stay certification.',
  },
] as const;

export type PublicRequest =
  | { provider: 'ibge-municipality'; municipalityId: string }
  | { provider: 'open-meteo'; latitude: number; longitude: number; nonCommercial: true };
export type PublicTransport = (url: URL) => Promise<Uint8Array>;

export class PublicSourceHttpError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly rejection: 'status' | 'content_type' | 'content_encoding',
  ) {
    super('PUBLIC_SOURCE_HTTP_REJECTED');
  }
}

const RESPONSE_LIMIT = 1_000_000;
const DNS_TIMEOUT_MS = 4000;
const HTTP_TIMEOUT_MS = 10000;
const WEATHER_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const WEATHER_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const WEATHER_CODES = new Set([
  0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86,
  95, 96, 99,
]);
const STATE_PREFIX: Record<string, string> = {
  '11': 'RO',
  '12': 'AC',
  '13': 'AM',
  '14': 'RR',
  '15': 'PA',
  '16': 'AP',
  '17': 'TO',
  '21': 'MA',
  '22': 'PI',
  '23': 'CE',
  '24': 'RN',
  '25': 'PB',
  '26': 'PE',
  '27': 'AL',
  '28': 'SE',
  '29': 'BA',
  '31': 'MG',
  '32': 'ES',
  '33': 'RJ',
  '35': 'SP',
  '41': 'PR',
  '42': 'SC',
  '43': 'RS',
  '50': 'MS',
  '51': 'MT',
  '52': 'GO',
  '53': 'DF',
};

function reject(): never {
  throw new Error('PUBLIC_SOURCE_INPUT_REJECTED');
}

function ownData(input: unknown): Record<string, unknown> {
  if (
    !input ||
    typeof input !== 'object' ||
    types.isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    reject();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string') reject();
    const descriptor = descriptors[key]!;
    if (!('value' in descriptor) || !descriptor.enumerable) reject();
    fields[key] = descriptor.value;
  }
  return fields;
}

function requestSnapshot(input: unknown): PublicRequest {
  const fields = ownData(input);
  if (fields.provider === 'ibge-municipality') {
    if (
      Object.keys(fields).sort().join(',') !== 'municipalityId,provider' ||
      typeof fields.municipalityId !== 'string' ||
      !/^\d{7}$/.test(fields.municipalityId) ||
      !STATE_PREFIX[fields.municipalityId.slice(0, 2)]
    )
      reject();
    return Object.freeze({ provider: 'ibge-municipality', municipalityId: fields.municipalityId });
  }
  if (
    fields.provider !== 'open-meteo' ||
    fields.nonCommercial !== true ||
    Object.keys(fields).sort().join(',') !== 'latitude,longitude,nonCommercial,provider' ||
    typeof fields.latitude !== 'number' ||
    typeof fields.longitude !== 'number' ||
    !Number.isFinite(fields.latitude) ||
    !Number.isFinite(fields.longitude) ||
    Math.abs(fields.latitude) > 90 ||
    Math.abs(fields.longitude) > 180
  )
    reject();
  return Object.freeze({
    provider: 'open-meteo',
    latitude: fields.latitude,
    longitude: fields.longitude,
    nonCommercial: true,
  });
}

function snapshotUrl(input: PublicRequest): URL {
  if (input.provider === 'ibge-municipality')
    return new URL(
      'https://servicodados.ibge.gov.br/api/v1/localidades/municipios/' + input.municipalityId,
    );
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: String(input.latitude),
    longitude: String(input.longitude),
    current: 'temperature_2m,precipitation,weather_code',
    timezone: 'UTC',
    forecast_days: '1',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  }).toString();
  return url;
}

export function publicRequestUrl(input: unknown): URL {
  return snapshotUrl(requestSnapshot(input));
}

export function publicIpv4(address: string): boolean {
  if (typeof address !== 'string' || isIP(address) !== 4) return false;
  const [a, b, c, d] = address.split('.').map(Number);
  if ([a!, b!, c!, d!].some((value) => value > 255)) return false;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a! >= 224 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function fixedUrl(input: URL): URL {
  if (
    !input ||
    typeof input !== 'object' ||
    types.isProxy(input) ||
    Object.getPrototypeOf(input) !== URL.prototype
  )
    reject();
  let href: string;
  try {
    href = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!.call(input) as string;
  } catch {
    reject();
  }
  if (href.length > 2048) reject();
  const url = new URL(href);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) reject();
  if (url.hostname === 'servicodados.ibge.gov.br') {
    const identifier = /^\/api\/v1\/localidades\/municipios\/(\d{7})$/.exec(url.pathname)?.[1];
    if (
      !identifier ||
      href !==
        snapshotUrl(requestSnapshot({ provider: 'ibge-municipality', municipalityId: identifier }))
          .href
    )
      reject();
  } else if (url.hostname === 'api.open-meteo.com') {
    const latitude = Number(url.searchParams.get('latitude'));
    const longitude = Number(url.searchParams.get('longitude'));
    if (
      href !==
      snapshotUrl(
        requestSnapshot({ provider: 'open-meteo', latitude, longitude, nonCommercial: true }),
      ).href
    )
      reject();
  } else reject();
  return url;
}

async function withDeadline<T>(operation: Promise<T>, duration: number, code: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, rejectPromise) => {
    timer = setTimeout(() => rejectPromise(new Error(code)), duration);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** One fixed-host GET; pinned public DNS result, TLS validation, no cookies, redirects or retries. */
export async function readPublicJson(input: URL): Promise<Uint8Array> {
  const url = fixedUrl(input);
  let records: LookupAddress[];
  try {
    // OS getaddrinfo follows the workstation resolver policy. A timed-out lookup
    // cannot be cancelled portably, but its late result never starts an HTTP call.
    records = await withDeadline(
      lookup(url.hostname, { family: 4, all: true, verbatim: true }),
      DNS_TIMEOUT_MS,
      'PUBLIC_SOURCE_DNS_TIMEOUT',
    );
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message === 'PUBLIC_SOURCE_DNS_TIMEOUT'
        ? error.message
        : 'PUBLIC_SOURCE_DNS_FAILED',
    );
  }
  if (
    !Array.isArray(records) ||
    !records.length ||
    records.length > 32 ||
    records.some((record) => record.family !== 4 || !publicIpv4(record.address))
  )
    throw new Error('PUBLIC_SOURCE_ADDRESS_REJECTED');
  const pinned = records[0]!.address;
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    let req: ReturnType<typeof request> | undefined;
    const deadline = setTimeout(() => finish(new Error('PUBLIC_SOURCE_TIMEOUT')), HTTP_TIMEOUT_MS);
    function finish(error?: Error, data?: Uint8Array) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        req?.destroy();
        rejectPromise(error);
      } else resolve(data!);
    }
    try {
      req = request(
        url,
        {
          method: 'GET',
          agent: false,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          servername: url.hostname,
          headers: {
            accept: 'application/json',
            'accept-encoding': 'identity',
            'user-agent': 'TravelReliability/0.6 public-source-reader',
          },
          lookup: (_host, options, callback) => {
            if (_host !== url.hostname) {
              callback(new Error('PUBLIC_SOURCE_ADDRESS_REJECTED'), '', 4);
              return;
            }
            if (typeof options === 'object' && options.all)
              callback(null, [{ address: pinned, family: 4 }]);
            else callback(null, pinned, 4);
          },
        },
        (response) => {
          if (
            response.statusCode !== 200 ||
            !/^application\/json(?:;|$)/i.test(String(response.headers['content-type'] ?? '')) ||
            (response.headers['content-encoding'] &&
              !['identity', 'gzip'].includes(response.headers['content-encoding']))
          ) {
            const rejection =
              response.statusCode !== 200
                ? 'status'
                : !/^application\/json(?:;|$)/i.test(String(response.headers['content-type'] ?? ''))
                  ? 'content_type'
                  : 'content_encoding';
            response.destroy();
            finish(new PublicSourceHttpError(response.statusCode ?? 0, rejection));
            return;
          }
          const declaredLength = response.headers['content-length'];
          if (
            declaredLength !== undefined &&
            (!/^\d+$/.test(declaredLength) || Number(declaredLength) > RESPONSE_LIMIT)
          ) {
            response.destroy();
            finish(new Error('PUBLIC_SOURCE_RESPONSE_LIMIT'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            if (size > RESPONSE_LIMIT) {
              response.destroy();
              finish(new Error('PUBLIC_SOURCE_RESPONSE_LIMIT'));
            } else chunks.push(chunk);
          });
          response.on('end', () => {
            if (!response.complete) {
              finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED'));
              return;
            }
            try {
              const wireBody = Buffer.concat(chunks);
              const body =
                response.headers['content-encoding'] === 'gzip'
                  ? gunzipSync(wireBody, { maxOutputLength: RESPONSE_LIMIT })
                  : wireBody;
              if (body.byteLength > RESPONSE_LIMIT)
                finish(new Error('PUBLIC_SOURCE_RESPONSE_LIMIT'));
              else finish(undefined, body);
            } catch (error) {
              const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
              finish(
                code === 'ERR_BUFFER_TOO_LARGE'
                  ? new Error('PUBLIC_SOURCE_RESPONSE_LIMIT')
                  : new PublicSourceHttpError(200, 'content_encoding'),
              );
            }
          });
          response.on('aborted', () => finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED')));
          response.on('error', () => finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED')));
          response.on('close', () => {
            if (!settled && !response.complete) finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED'));
          });
        },
      );
      req.on('error', () => finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED')));
      req.end();
    } catch {
      finish(new Error('PUBLIC_SOURCE_TRANSPORT_FAILED'));
    }
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function utcMinute(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(value)) return undefined;
  const instant = Date.parse(value + ':00Z');
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value + ':00.000Z')
    return undefined;
  return instant;
}

export async function capturePublicSource(
  rawInput: unknown,
  policy: unknown,
  transport: PublicTransport = readPublicJson,
) {
  const input = requestSnapshot(rawInput);
  const approved = ownData(policy);
  if (
    Object.keys(approved).join(',') !== 'allowNetwork' ||
    typeof approved.allowNetwork !== 'boolean'
  )
    reject();
  if (approved.allowNetwork !== true) throw new Error('PUBLIC_SOURCE_NETWORK_NOT_APPROVED');
  const url = snapshotUrl(input);
  const sourceUrl = url.href;
  const bytes = await transport(url);
  if (
    !bytes ||
    types.isProxy(bytes) ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > RESPONSE_LIMIT
  )
    throw new Error('PUBLIC_SOURCE_RESPONSE_LIMIT');
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('PUBLIC_SOURCE_JSON_REJECTED');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('PUBLIC_SOURCE_JSON_REJECTED');
  const raw = body as Record<string, unknown>;
  let data: Record<string, unknown>;
  const name = (value: unknown) =>
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 100 &&
    !/[\x00-\x1f\x7f]/.test(value);
  if (input.provider === 'ibge-municipality') {
    const modern = record(record(record(raw['regiao-imediata'])?.['regiao-intermediaria'])?.UF);
    const legacy = record(record(record(raw.microrregiao)?.mesorregiao)?.UF);
    const expectedState = STATE_PREFIX[input.municipalityId.slice(0, 2)];
    const states = [modern, legacy].filter((value) => value !== undefined);
    if (
      typeof raw.id !== 'number' ||
      !Number.isInteger(raw.id) ||
      String(raw.id) !== input.municipalityId ||
      !name(raw.nome) ||
      !states.length ||
      states.some(
        (state) =>
          state.sigla !== expectedState ||
          (state.id !== undefined && state.id !== Number(input.municipalityId.slice(0, 2))),
      )
    )
      throw new Error('PUBLIC_SOURCE_SCHEMA_REJECTED');
    data = {
      municipalityId: input.municipalityId,
      municipalityName: raw.nome,
      stateCode: expectedState,
      countryCode: 'BR',
    };
  } else {
    const current = record(raw.current);
    const units = record(raw.current_units);
    const forecastTime = utcMinute(current?.time);
    if (
      !current ||
      !units ||
      units.temperature_2m !== '°C' ||
      units.precipitation !== 'mm' ||
      units.time !== 'iso8601' ||
      units.weather_code !== 'wmo code' ||
      units.interval !== 'seconds' ||
      (raw.timezone !== 'GMT' && raw.timezone !== 'UTC') ||
      raw.utc_offset_seconds !== 0 ||
      forecastTime === undefined ||
      typeof current.interval !== 'number' ||
      !Number.isInteger(current.interval) ||
      current.interval < 1 ||
      current.interval > 3600 ||
      typeof current.temperature_2m !== 'number' ||
      !Number.isFinite(current.temperature_2m) ||
      Math.abs(current.temperature_2m) > 100 ||
      typeof current.precipitation !== 'number' ||
      !Number.isFinite(current.precipitation) ||
      current.precipitation < 0 ||
      current.precipitation > 2000 ||
      typeof current.weather_code !== 'number' ||
      !Number.isInteger(current.weather_code) ||
      !WEATHER_CODES.has(current.weather_code)
    )
      throw new Error('PUBLIC_SOURCE_SCHEMA_REJECTED');
    data = {
      forecastAtUtc: current.time + ':00Z',
      temperatureC: current.temperature_2m,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
    };
  }
  const observed = Date.now();
  const forecastAge =
    input.provider === 'open-meteo' ? observed - Date.parse(String(data.forecastAtUtc)) : undefined;
  const fresh =
    forecastAge !== undefined &&
    forecastAge >= -WEATHER_FUTURE_TOLERANCE_MS &&
    forecastAge <= WEATHER_MAX_AGE_MS;
  const expires =
    input.provider === 'open-meteo'
      ? fresh
        ? Math.min(
            observed + 15 * 60 * 1000,
            Date.parse(String(data.forecastAtUtc)) + WEATHER_MAX_AGE_MS,
          )
        : observed
      : observed + 24 * 60 * 60 * 1000;
  return {
    provider: input.provider,
    sourceUrl,
    observedAt: new Date(observed).toISOString(),
    freshness:
      input.provider === 'open-meteo'
        ? fresh
          ? 'fresh_within_three_hours'
          : 'stale_or_future_requires_review'
        : 'administrative_snapshot_not_supplier_status',
    cache: {
      expiresAt: new Date(expires).toISOString(),
      maxAgeSeconds: Math.max(0, Math.floor((expires - observed) / 1000)),
    },
    responseSha256: createHash('sha256').update(bytes).digest('hex'),
    responseDigestScope: 'decoded_json_body_bytes',
    responseByteLength: bytes.byteLength,
    data,
    interpretation: 'passive_data_not_instructions',
    factsVerified: false,
    effects: { networkRequests: 1, modelCalls: 0, supplierAccounts: 0, filesystemWrites: 0 },
    attribution:
      input.provider === 'open-meteo'
        ? 'Weather data by Open-Meteo.com, CC BY 4.0; non-commercial free endpoint.'
        : 'IBGE — API de localidades.',
  };
}
