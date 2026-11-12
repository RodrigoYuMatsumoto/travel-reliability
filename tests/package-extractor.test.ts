import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  createPackageExtractor,
  PACKAGE_EXTRACTOR_LIMITS,
  type PackageExtractionRequest,
} from '../agent/package-extractor.js';
import { packageObservationSchema } from '../schema/src/package-observation.js';
import { plan } from '../api/src/planning.js';
import { packageArbitrageExample } from '../web/src/package-arbitrage-example.js';

const fixtures = new URL('../ingest/tests/fixtures/packages/', import.meta.url);
const html = (name: string) => readFileSync(new URL(`${name}.html`, fixtures), 'utf8');
const golden = (name: string) =>
  JSON.parse(readFileSync(new URL(`expected/${name}.json`, fixtures), 'utf8'));
// Same parameters as ingest/tests/test_packages_golden.py.
const OBSERVED_AT = '2026-11-04T12:00:00-03:00';
const cases: Array<
  [string, PackageExtractionRequest['site'], string, PackageExtractionRequest['retrieval']]
> = [
  ['atrativa_detail', 'atrativa', 'https://atrativa.example.invalid/viagem.php?v=101', 'fixture'],
  ['niel_detail', 'niel', 'https://niel.example.invalid/pacote/destino-sintetico', 'fixture'],
  [
    'valle_detail',
    'valle',
    'https://valle.example.invalid/home/dezembro-destino-sintetico-p1001',
    'fixture',
  ],
  [
    'augustus_static_shell',
    'augustus',
    'https://augustus.example.invalid/#/pacote/7',
    'static_html',
  ],
  [
    'augustus_rendered_detail',
    'augustus',
    'https://augustus.example.invalid/#/pacote/7',
    'rendered_dom',
  ],
];
const ajv = new Ajv2020({ strict: true, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validate = ajv.compile(packageObservationSchema);
const extract = createPackageExtractor({ timeoutMs: 30000 });
const code = async (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (error) => (error as { code?: string }).code,
  );

describe('package observation contract between Python and Node', () => {
  it('bounds trusted HTML configuration without changing the default boundary', async () => {
    for (const maxHtmlBytes of [0, -1, 1.5, 1_000_001, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => createPackageExtractor({ maxHtmlBytes })).toThrow(
        'INVALID_PACKAGE_EXTRACTOR_CONFIG',
      );
    const minimal = createPackageExtractor({
      maxHtmlBytes: 1,
      interpreterPath: 'synthetic-missing-interpreter',
    });
    expect(
      await code(
        minimal({
          html: 'xx',
          url: 'https://synthetic.example.invalid',
          observedAt: OBSERVED_AT,
          retrieval: 'fixture',
          mode: 'detail',
        }),
      ),
    ).toBe('PACKAGE_HTML_REJECTED');
    expect(() => createPackageExtractor({ maxHtmlBytes: 1_000_000 })).not.toThrow();
  });

  it('validates every Python golden observation against the TypeScript schema', () => {
    const names = readdirSync(new URL('expected/', fixtures)).filter((n) => n.endsWith('.json'));
    expect(names.length).toBeGreaterThanOrEqual(cases.length);
    for (const name of names) {
      const value = JSON.parse(readFileSync(new URL(`expected/${name}`, fixtures), 'utf8'));
      expect(validate(value), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
    }
  });

  it('bridges to the isolated Python extractor and returns the golden observation', async () => {
    for (const [name, site, url, retrieval] of cases) {
      const result = await extract({
        html: html(name),
        url,
        observedAt: OBSERVED_AT,
        retrieval,
        site,
        mode: 'detail',
      });
      expect(result, name).toEqual(golden(name));
    }
  }, 120000);

  it('never turns the static Augustus shell into a price and keeps contacts out', async () => {
    const shell = golden('augustus_static_shell');
    expect(shell.price.amountMinor).toBeNull();
    expect(shell.warnings).toEqual(
      expect.arrayContaining(['STATIC_SHELL_NOT_EVIDENCE', 'RENDER_REQUIRED']),
    );
    const text = JSON.stringify(cases.map(([name]) => golden(name)));
    expect(text).not.toMatch(/whatsapp|wa\.me|@example\.invalid|\+55/i);
  });

  it('rejects oversized pages, non-https and Instagram before starting Python', async () => {
    const base = {
      html: '<p>x</p>',
      url: 'https://atrativa.example.invalid/viagem.php?v=1',
      observedAt: OBSERVED_AT,
      retrieval: 'static_html' as const,
      mode: 'detail' as const,
    };
    expect(
      await code(extract({ ...base, html: 'x'.repeat(PACKAGE_EXTRACTOR_LIMITS.htmlBytes + 1) })),
    ).toBe('PACKAGE_HTML_REJECTED');
    expect(await code(extract({ ...base, url: 'http://atrativa.example.invalid/v' }))).toBe(
      'PACKAGE_URL_REJECTED',
    );
    expect(await code(extract({ ...base, url: 'https://www.instagram.com/agencia/' }))).toBe(
      'INSTAGRAM_NOT_SUPPORTED',
    );
    expect(await code(extract({ ...base, observedAt: 'ontem' }))).toBe('INVALID_TIMESTAMP');
  });

  it('feeds an extracted observation into the package-arbitrage calculator', async () => {
    const observation = await extract({
      html: html('atrativa_detail'),
      url: 'https://atrativa.example.invalid/viagem.php?v=101',
      observedAt: OBSERVED_AT,
      retrieval: 'fixture',
      site: 'atrativa',
      mode: 'detail',
    });
    const output = plan('package-arbitrage', { ...packageArbitrageExample, package: observation });
    const result = output.result as { scenarios: unknown[]; final: boolean; pending: string[] };
    expect(output.externalCalls).toBe(0);
    expect(result.scenarios.length).toBeGreaterThan(0);
    // The fixture does not say whether the price is per person, so nothing is final.
    expect(result.final).toBe(false);
    expect(result.pending.join(' ')).toMatch(/PRICE_BASIS_UNKNOWN/);
  }, 60000);
});

describe('travel_extract_package over MCP', () => {
  it('extracts offline through the stdio server and refuses Instagram', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('../scripts/agent-mcp.mjs', import.meta.url))],
      cwd: tmpdir(),
      stderr: 'pipe',
    });
    const client = new Client({ name: 'synthetic-test-client', version: '1.0.0' });
    await client.connect(transport);
    try {
      const tool = (await client.listTools()).tools.find(
        (item) => item.name === 'travel_extract_package',
      )!;
      expect(tool.annotations?.openWorldHint).toBe(false);
      const ok = await client.callTool({
        name: 'travel_extract_package',
        arguments: {
          html: html('augustus_rendered_detail'),
          url: 'https://augustus.example.invalid/#/pacote/7',
          observedAt: OBSERVED_AT,
          retrieval: 'rendered_dom',
          site: 'augustus',
        },
      });
      const body = JSON.parse((ok as { content: Array<{ text: string }> }).content[0]!.text) as {
        extraction: string;
        result: unknown;
      };
      expect(body.extraction).toBe('literal_unconfirmed');
      expect(body).toHaveProperty('inputTrust', 'caller_supplied_unverified');
      expect(body.result).toEqual(golden('augustus_rendered_detail'));
      const refused = await client.callTool({
        name: 'travel_extract_package',
        arguments: {
          html: '<p>x</p>',
          url: 'https://www.instagram.com/agencia/',
          observedAt: OBSERVED_AT,
          retrieval: 'static_html',
        },
      });
      expect((refused as { isError?: boolean }).isError).toBe(true);
      const oversized = await client.callTool({
        name: 'travel_extract_package',
        arguments: {
          html: '<p>' + 'x'.repeat(PACKAGE_EXTRACTOR_LIMITS.htmlBytes) + '</p>',
          url: 'https://atrativa.example.invalid/viagem.php?v=1',
          observedAt: OBSERVED_AT,
          retrieval: 'static_html',
        },
      });
      expect((oversized as { isError?: boolean }).isError).toBe(true);
    } finally {
      await client.close();
    }
  }, 120000);
});
