import { parseArgs } from 'node:util';
import {
  capturePublicSource,
  publicSourceCatalog,
  PublicSourceHttpError,
} from '../agent/public-sources.js';

const hints: Record<string, string> = {
  PUBLIC_SOURCE_INPUT_REJECTED:
    'Use a catalog provider and its exact fields; use --latitude=-23.55 for a negative coordinate. Do not pass credentials or arbitrary URLs.',
  PUBLIC_SOURCE_NETWORK_NOT_APPROVED:
    'An actual request requires explicit --allow-network; otherwise use --catalog or an official assisted snapshot.',
  PUBLIC_SOURCE_DNS_TIMEOUT:
    'The OS resolver exceeded its deadline. Check the approved network or use an official assisted snapshot; no HTTP request followed this timeout.',
  PUBLIC_SOURCE_DNS_FAILED:
    'The OS resolver could not resolve the fixed provider. Check network access or use the catalog assisted alternative.',
  PUBLIC_SOURCE_ADDRESS_REJECTED:
    'A non-public or unexpected address was rejected. Do not override the address guard.',
  PUBLIC_SOURCE_TIMEOUT:
    'The HTTPS request exceeded its deadline. Record this source as unavailable; do not infer current data.',
  PUBLIC_SOURCE_TRANSPORT_FAILED:
    'HTTPS could not complete. Check approved network and certificates; do not disable TLS validation.',
  PUBLIC_SOURCE_HTTP_REJECTED:
    'The provider returned a rejected status, redirect, content type or encoding. No redirect was followed.',
  PUBLIC_SOURCE_RESPONSE_LIMIT:
    'The response exceeded the supported limit or transport contract. Use a reviewed source snapshot instead.',
  PUBLIC_SOURCE_JSON_REJECTED:
    'The response is not supported UTF-8 JSON. It was not accepted as travel evidence.',
  PUBLIC_SOURCE_SCHEMA_REJECTED:
    'Required identity, units or observation fields are missing or inconsistent. Review the provider response schema before accepting it.',
};

function coordinate(value: string | undefined): number {
  if (typeof value !== 'string' || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))
    throw new Error('PUBLIC_SOURCE_INPUT_REJECTED');
  return Number(value);
}

try {
  const { values } = parseArgs({
    options: {
      catalog: { type: 'boolean' },
      provider: { type: 'string' },
      municipality: { type: 'string' },
      latitude: { type: 'string' },
      longitude: { type: 'string' },
      'allow-network': { type: 'boolean', default: false },
      'non-commercial': { type: 'boolean', default: false },
    },
  });
  if (values.catalog) {
    if (
      values.provider ||
      values.municipality ||
      values.latitude ||
      values.longitude ||
      values['allow-network'] ||
      values['non-commercial']
    )
      throw new Error('PUBLIC_SOURCE_INPUT_REJECTED');
    process.stdout.write(JSON.stringify(publicSourceCatalog, null, 2) + '\n');
  } else {
    if (!['ibge-municipality', 'open-meteo'].includes(values.provider ?? ''))
      throw new Error('PUBLIC_SOURCE_INPUT_REJECTED');
    if (
      (values.provider === 'ibge-municipality' &&
        (values.latitude !== undefined ||
          values.longitude !== undefined ||
          values['non-commercial'])) ||
      (values.provider === 'open-meteo' && values.municipality !== undefined)
    )
      throw new Error('PUBLIC_SOURCE_INPUT_REJECTED');
    const input =
      values.provider === 'ibge-municipality'
        ? { provider: 'ibge-municipality' as const, municipalityId: values.municipality ?? '' }
        : {
            provider: 'open-meteo' as const,
            latitude: coordinate(values.latitude),
            longitude: coordinate(values.longitude),
            nonCommercial: values['non-commercial'] as true,
          };
    const result = await capturePublicSource(input, {
      allowNetwork: values['allow-network'] === true,
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
} catch (error) {
  const candidate = error instanceof Error ? error.message : '';
  const code = Object.hasOwn(hints, candidate) ? candidate : 'PUBLIC_SOURCE_INPUT_REJECTED';
  const unavailable = [
    'DNS_TIMEOUT',
    'DNS_FAILED',
    'TIMEOUT',
    'TRANSPORT_FAILED',
    'HTTP_REJECTED',
    'NETWORK_NOT_APPROVED',
  ].some((suffix) => code === 'PUBLIC_SOURCE_' + suffix);
  process.stderr.write(
    JSON.stringify({
      status: unavailable ? 'BLOCKED' : 'FAIL',
      error: code,
      hint: hints[code],
      ...(error instanceof PublicSourceHttpError
        ? { httpStatus: error.httpStatus, rejection: error.rejection }
        : {}),
      modelCalls: 0,
    }) + '\n',
  );
  process.exitCode = 1;
}
