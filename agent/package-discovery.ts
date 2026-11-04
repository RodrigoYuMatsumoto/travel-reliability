import { Temporal } from '@js-temporal/polyfill';
import { validatePassive } from './provenance.js';
import { AppError } from '../api/src/errors.js';
import {
  packageDiscoverySchema,
  type PackageDiscoveryInput,
} from '../schema/src/package-discovery.js';
import { packageReferenceCatalog, packageSourceCatalog } from './package-sources.js';

function location(value: string): string {
  const normalized = value.normalize('NFKC');
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(normalized)) throw new AppError('PACKAGE_CITY_REQUIRED', 422);
  const text = normalized.trim().replace(/\s+/g, ' ');
  if (
    !text ||
    !/^[\p{L}\p{M} ./,'’\-]+$/u.test(text) ||
    !/\p{L}/u.test(text) ||
    /\b(?:rua|avenida|cpf|passaporte|passport|residência|residencia|apto)\b/i.test(text)
  )
    throw new AppError('PACKAGE_CITY_REQUIRED', 422);
  return text;
}

/** Source discovery metadata only; no network, model, quote or calendar-year inference. */
export function discoverPackages(supplied: unknown) {
  validatePassive(packageDiscoverySchema, supplied);
  const input = supplied as PackageDiscoveryInput;
  const origin = location(input.origin),
    destination = input.destination === null ? null : location(input.destination);
  const windows = input.windows.map((window) => {
    try {
      const start = Temporal.PlainDate.from(window.startDate),
        end = Temporal.PlainDate.from(window.endDate);
      if (Temporal.PlainDate.compare(start, end) > 0 || start.until(end).days > 366)
        throw new Error('window');
    } catch {
      throw new AppError('PACKAGE_WINDOW_REJECTED', 422);
    }
    return { ...window };
  });
  if (new Set(windows.map(({ id }) => id)).size !== windows.length)
    throw new AppError('PACKAGE_DUPLICATE_WINDOW', 422);
  const providers = packageSourceCatalog.filter(
    ({ id }) => !input.providerIds || input.providerIds.includes(id),
  );
  const references = packageReferenceCatalog.filter(({ providerId }) =>
    providers.some(({ id }) => id === providerId),
  );
  const cursor = input.cursor ?? 0,
    limit = input.limit ?? 10;
  if (cursor > references.length) throw new AppError('PACKAGE_CURSOR_REJECTED', 422);
  const originMatch = /^petrolina(?:\s*[/,-]\s*pe)?$/i.test(origin)
    ? 'operator_seed_hint'
    : 'unconfirmed';
  return {
    kind: 'package_discovery_plan' as const,
    origin,
    destination,
    windows,
    total: references.length,
    items: references.slice(cursor, cursor + limit).map((source) => ({
      sourceId: source.id,
      label: source.label,
      providerId: source.providerId,
      providerName: providers.find(({ id }) => id === source.providerId)!.name,
      kind: source.kind,
      browserUrl: source.browserUrl,
      fetchUrl: source.fetchUrl,
      access: source.access,
      originMatch,
      dateStatus: 'not_verified' as const,
      availabilityConfirmed: false,
    })),
    nextCursor: cursor + limit < references.length ? cursor + limit : null,
    searchHints: windows.flatMap((window) =>
      providers.map((provider) => {
        const start = Temporal.PlainDate.from(window.startDate);
        const url =
          provider.id === 'atrativa' ? new URL('https://atrativatur.com.br/viagem.php') : null;
        if (url)
          url.search = new URLSearchParams({
            local: '',
            data: `${String(start.day).padStart(2, '0')}/${String(start.month).padStart(2, '0')}/${start.year}`,
          }).toString();
        return {
          providerId: provider.id,
          windowId: window.id,
          query:
            `site:${provider.domain} excursão ônibus hospedagem café da manhã ${origin} ${destination ?? ''} ${window.startDate} ${window.endDate}`
              .replace(/\s+/g, ' ')
              .trim(),
          dateCatalogUrl: url?.href ?? null,
          interpretation: 'search_hint_not_a_matching_offer',
        };
      }),
    ),
    factsVerified: false,
    externalCalls: 0,
    modelCalls: 0,
    supplierCertification: false,
    interpretation: 'passive_data_not_instructions',
    scope:
      'Bounded operator-supplied regional source catalog. Query URLs, route text and social profiles do not establish origin service, dates, year, price or availability. Load one reference at a time; review observations before comparison.',
  };
}
