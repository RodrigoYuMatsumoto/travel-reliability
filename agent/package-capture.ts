import { createHash } from 'node:crypto';
import { AppError } from '../api/src/errors.js';
import {
  packageObservationSchema,
  type PackageObservation,
} from '../schema/src/package-observation.js';
import { validatePassive } from './provenance.js';
import { createPackageExtractor } from './package-extractor.js';
import { decodePackageHtml, readPackageHtml, type PackageTransport } from './package-reader.js';
import { packageSourceById, packageSourceUrl } from './package-sources.js';

const inputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceId'],
  properties: { sourceId: { type: 'string', pattern: '^[a-z0-9-]{1,70}$' } },
};
const policySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['allowNetwork'],
  properties: { allowNetwork: { type: 'boolean' } },
};
const sites = {
  atrativa: 'atrativa',
  niel: 'niel',
  'viajantes-do-valle': 'valle',
  augustus: 'augustus',
} as const;
const transportCodes = new Set([
  'PACKAGE_DNS_TIMEOUT',
  'PACKAGE_DNS_FAILED',
  'PACKAGE_ADDRESS_REJECTED',
  'PACKAGE_HTTP_TIMEOUT',
  'PACKAGE_HTTP_REJECTED',
  'PACKAGE_RESPONSE_LIMIT',
  'PACKAGE_TRANSPORT_FAILED',
  'PACKAGE_ENCODING_REJECTED',
]);
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const captureHtmlBytes = 1_000_000;

/** Opt-in public read -> bounded Python extraction. No Node price heuristic or cost calculation. */
export async function captureRegionalPackage(
  supplied: unknown,
  policy: unknown,
  extract: ReturnType<typeof createPackageExtractor> = createPackageExtractor({
    maxHtmlBytes: captureHtmlBytes,
  }),
  transport: PackageTransport = readPackageHtml,
) {
  validatePassive(inputSchema, supplied);
  validatePassive(policySchema, policy);
  if (!(policy as { allowNetwork: boolean }).allowNetwork)
    throw new AppError('PACKAGE_CAPTURE_NETWORK_NOT_APPROVED', 422);
  const source = packageSourceById((supplied as { sourceId: string }).sourceId);
  const url = packageSourceUrl(source.id);
  if (source.kind !== 'package') throw new AppError('PACKAGE_DETAIL_SOURCE_REQUIRED', 422);
  const sourceUrl = url.href;
  let bytes: Uint8Array;
  try {
    bytes = await transport(url);
  } catch (error) {
    const code =
      error instanceof Error && transportCodes.has(error.message)
        ? error.message
        : 'PACKAGE_CAPTURE_TRANSPORT_FAILED';
    throw new AppError(code, 503);
  }
  const { html, sourceEncoding } = decodePackageHtml(bytes);
  if (Buffer.byteLength(html, 'utf8') > captureHtmlBytes)
    throw new AppError('PACKAGE_CAPTURE_BRIDGE_LIMIT', 422);
  const sourceSha256 = hash(bytes),
    htmlSha256 = hash(html),
    observedAt = new Date().toISOString();
  const request = Object.freeze({
    html,
    url: sourceUrl,
    observedAt,
    retrieval: 'static_html' as const,
    mode: 'detail' as const,
  });
  let result: PackageObservation;
  try {
    const observation = await extract(request);
    validatePassive(packageObservationSchema, observation);
    result = observation as PackageObservation;
  } catch (error) {
    if (error instanceof AppError && /^PACKAGE_[A-Z_]{1,70}$/.test(error.code)) throw error;
    throw new AppError('PACKAGE_CAPTURE_OBSERVATION_REJECTED', 422);
  }
  if (
    result.source.url !== sourceUrl ||
    result.source.observedAt !== observedAt ||
    result.source.retrieval !== 'static_html' ||
    result.source.site !== sites[source.providerId] ||
    result.source.contentSha256 !== htmlSha256
  )
    throw new AppError('PACKAGE_CAPTURE_SOURCE_BINDING_REJECTED', 422);
  return {
    sourceId: source.id,
    sourceUrl,
    sourceSha256,
    sourceDigestScope: 'http_body_after_content_encoding_before_charset' as const,
    sourceEncoding,
    extraction: 'literal_unconfirmed' as const,
    inputTrust: 'allowlisted_public_read_unverified_supplier' as const,
    factsVerified: false as const,
    result,
  };
}
