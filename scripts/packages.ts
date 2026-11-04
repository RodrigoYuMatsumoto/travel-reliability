import { parseArgs } from 'node:util';
import { discoverPackages } from '../agent/package-discovery.js';
import { packageReferenceCatalog, packageSourceCatalog } from '../agent/package-sources.js';
import { captureRegionalPackage } from '../agent/package-capture.js';

try {
  const { values } = parseArgs({
    options: {
      catalog: { type: 'boolean' },
      origin: { type: 'string' },
      destination: { type: 'string' },
      url: { type: 'string' },
      start: { type: 'string' },
      end: { type: 'string' },
      'second-start': { type: 'string' },
      'second-end': { type: 'string' },
      provider: { type: 'string', multiple: true },
      limit: { type: 'string' },
      cursor: { type: 'string' },
      capture: { type: 'string', multiple: true },
      'allow-network': { type: 'boolean', default: false },
    },
  });
  let captures = values.capture ?? [];
  if (values.url) {
    if (captures.length || values.catalog) throw new Error('PACKAGES_INPUT_CONFLICT');
    const url = new URL(values.url);
    const source = packageReferenceCatalog.find((reference) => reference.browserUrl === url.href);
    if (!source) throw new Error('PACKAGE_SOURCE_REJECTED');
    if (!values['allow-network']) {
      console.log(
        JSON.stringify({
          kind: 'regional_package_workflow',
          sourceId: source.id,
          sourceUrl: source.browserUrl,
          captureStatus:
            source.access === 'static_html'
              ? 'explicit_network_approval_required'
              : 'assisted_source_required',
          workflowId: 'package-arbitrage',
          extractionTool: 'travel_extract_package',
          quoteNeeds: [
            'bus_round_trip',
            'air_round_trip',
            'lodging_breakfast',
            'lodging_room_only',
            'external_breakfast',
            'mandatory_extras',
          ],
          factsVerified: false,
          externalCalls: 0,
          modelCalls: 0,
        }),
      );
      process.exit(0);
    }
    captures = [source.id];
  }
  if (values.catalog) {
    if (captures.length || values['allow-network']) throw new Error('PACKAGES_CATALOG_IS_OFFLINE');
    console.log(
      JSON.stringify({
        kind: 'package_provider_catalog',
        providers: packageSourceCatalog,
        externalCalls: 0,
      }),
    );
  } else if (captures.length) {
    if (captures.length > 4 || new Set(captures).size !== captures.length)
      throw new Error('PACKAGES_CAPTURE_BUDGET_REJECTED');
    if (!values['allow-network']) throw new Error('PACKAGES_NETWORK_APPROVAL_REQUIRED');
    const pages: unknown[] = [];
    for (const [index, sourceId] of captures.entries()) {
      try {
        pages.push(await captureRegionalPackage({ sourceId }, { allowNetwork: true }));
      } catch (error) {
        const code =
          error instanceof Error && /^[A-Z_]{1,100}$/.test(error.message)
            ? error.message
            : 'PACKAGE_CAPTURE_REJECTED';
        pages.push({ sourceOrdinal: index + 1, status: 'unavailable', code, factsVerified: false });
      }
    }
    console.log(
      JSON.stringify({
        kind: 'package_source_captures',
        partial: pages.some((page) => (page as { status?: string }).status === 'unavailable'),
        pages,
        factsVerified: false,
        modelCalls: 0,
        maxNetworkRequests: captures.length,
      }),
    );
    if (pages.every((page) => (page as { status?: string }).status === 'unavailable'))
      process.exitCode = 2;
  } else {
    const number = (value: string | undefined, fallback: number) => {
      if (value === undefined) return fallback;
      if (!/^\d{1,5}$/.test(value)) throw new Error('PACKAGES_PAGINATION_REJECTED');
      return Number(value);
    };
    const windows = [{ id: 'window-1', startDate: values.start, endDate: values.end }];
    if (values['second-start'] || values['second-end'])
      windows.push({
        id: 'window-2',
        startDate: values['second-start'],
        endDate: values['second-end'],
      });
    console.log(
      JSON.stringify(
        discoverPackages({
          origin: values.origin,
          destination: values.destination ?? null,
          windows,
          ...(values.provider ? { providerIds: values.provider } : {}),
          limit: number(values.limit, 12),
          cursor: number(values.cursor, 0),
        }),
      ),
    );
  }
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]{1,100}$/.test(error.message)
      ? error.message
      : 'PACKAGES_REQUEST_REJECTED';
  console.error(
    JSON.stringify({
      status: 'FAIL',
      code,
      hint: 'Use --catalog, or --origin CITY --start YYYY-MM-DD --end YYYY-MM-DD. Captures require --capture SOURCE_ID --allow-network; no arbitrary URL, login or reservation is supported.',
    }),
  );
  process.exitCode = 1;
}
