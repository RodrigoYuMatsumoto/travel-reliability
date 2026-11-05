import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { captureRegionalPackage } from '../agent/package-capture.js';
import { packageCaptureReadiness, packageReferenceCatalog } from '../agent/package-sources.js';
import type { PackageExtractionRequest } from '../agent/package-extractor.js';
import type { PackageObservation } from '../schema/src/package-observation.js';

const io = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:https', () => ({ request: io.request }));
const fixtures = new URL('../ingest/tests/fixtures/packages/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name + '.html', fixtures), 'utf8');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const observed = (request: PackageExtractionRequest): PackageObservation => ({
  ...JSON.parse(readFileSync(new URL('expected/atrativa_detail.json', fixtures), 'utf8')),
  source: {
    url: request.url,
    site: 'atrativa',
    observedAt: request.observedAt,
    retrieval: request.retrieval,
    contentSha256: hash(request.html),
  },
});
function http(bytes: Uint8Array, charset = 'utf-8') {
  io.request.mockImplementation((_url, _options, callback) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: { 'content-type': 'text/html; charset=' + charset },
      complete: true,
      destroy() {
        return this;
      },
    });
    return Object.assign(new EventEmitter(), {
      destroy() {
        return this;
      },
      end() {
        queueMicrotask(() => {
          callback(response);
          response.emit('data', Buffer.from(bytes));
          response.emit('end');
        });
      },
    });
  });
}

describe('allowlisted HTTP to the adopted Python package extractor', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    io.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checks source and policy before any HTTP or extraction', async () => {
    const extract = vi.fn(),
      transport = vi.fn();
    for (const [input, policy] of [
      [{ sourceId: 'atrativa-1823' }, { allowNetwork: false }],
      [{ sourceId: 'atrativa-1823', url: 'https://evil.invalid' }, { allowNetwork: true }],
      [{ sourceId: 'unknown' }, { allowNetwork: true }],
      [{ sourceId: 'niel-instagram' }, { allowNetwork: true }],
      [{ sourceId: 'augustus-morro-reveillon' }, { allowNetwork: true }],
      [{ sourceId: 'atrativa-date-catalog' }, { allowNetwork: true }],
      [{ sourceId: 'atrativa-1823' }, { allowNetwork: true, credentials: 'SYNTHETIC' }],
    ])
      await expect(captureRegionalPackage(input, policy, extract, transport)).rejects.toThrow();
    expect(extract).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(io.lookup).not.toHaveBeenCalled();
    expect(io.request).not.toHaveBeenCalled();
  });

  it('plans network approval only for references the capture actually reads', async () => {
    for (const source of packageReferenceCatalog) {
      const transport = vi.fn(async () => {
        throw new Error('PACKAGE_TRANSPORT_FAILED');
      });
      const attempt = captureRegionalPackage(
        { sourceId: source.id },
        { allowNetwork: true },
        vi.fn(),
        transport,
      );
      const readiness = packageCaptureReadiness(source);
      if (readiness === 'explicit_network_approval_required') {
        await expect(attempt, source.id).rejects.toThrow('TRANSPORT_FAILED');
        expect(transport, source.id).toHaveBeenCalledTimes(1);
      } else {
        await expect(attempt, source.id).rejects.toThrow(
          readiness === 'package_detail_source_required'
            ? 'PACKAGE_DETAIL_SOURCE_REQUIRED'
            : 'PACKAGE_ASSISTED_SOURCE_REQUIRED',
        );
        expect(transport, source.id).not.toHaveBeenCalled();
      }
    }
  });

  it('never reads accessor-backed input before schema validation', async () => {
    let count = 0;
    const input = Object.defineProperty({}, 'sourceId', {
      enumerable: true,
      get() {
        count++;
        return 'atrativa-1823';
      },
    });
    const transport = vi.fn();
    await expect(
      captureRegionalPackage(input, { allowNetwork: true }, vi.fn(), transport),
    ).rejects.toThrow();
    expect(count).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });

  it('preserves observedAt and separates original byte hash from the UTF-8 extraction hash', async () => {
    const html = '<html><p>Café da manhã incluído</p><p>Valor à vista R$900</p></html>';
    const bytes = Buffer.from(html, 'latin1');
    http(bytes, 'iso-8859-1');
    const extract = vi.fn(async (request: PackageExtractionRequest) => {
      expect(request).toMatchObject({ html, mode: 'detail', retrieval: 'static_html' });
      expect(request).not.toHaveProperty('site');
      return observed(request);
    });
    const result = await captureRegionalPackage(
      { sourceId: 'atrativa-1823' },
      { allowNetwork: true },
      extract,
    );
    expect(result.sourceSha256).toBe(hash(bytes));
    expect(result.result.source.contentSha256).toBe(hash(html));
    expect(result.sourceSha256).not.toBe(result.result.source.contentSha256);
    expect(result.sourceEncoding).toBe('windows-1252');
    expect(result).toMatchObject({
      extraction: 'literal_unconfirmed',
      inputTrust: 'allowlisted_public_read_unverified_supplier',
      factsVerified: false,
    });
    expect(result.result.source.observedAt).toBe(extract.mock.calls[0]![0].observedAt);
    expect(JSON.stringify(result)).not.toContain('<html>');
  });

  it('rejects decoded UTF-8 over 1 MB without truncation or a Python call', async () => {
    const extract = vi.fn();
    const bytes = Buffer.from(
      '<html><meta charset="iso-8859-1">' + 'é'.repeat(510_000) + '</html>',
      'latin1',
    );
    await expect(
      captureRegionalPackage(
        { sourceId: 'atrativa-1823' },
        { allowNetwork: true },
        extract,
        async () => bytes,
      ),
    ).rejects.toThrow('PACKAGE_CAPTURE_BRIDGE_LIMIT');
    expect(extract).not.toHaveBeenCalled();
  });

  it.each(['url', 'observedAt', 'site', 'retrieval', 'contentSha256'] as const)(
    'rejects a Python observation bound to different %s',
    async (field) => {
      const extract = vi.fn(async (request: PackageExtractionRequest) => {
        const value = observed(request);
        const alternatives = {
          url: 'https://other.example.invalid',
          observedAt: '2026-01-01T00:00:00Z',
          site: 'niel',
          retrieval: 'fixture',
          contentSha256: '0'.repeat(64),
        };
        return {
          ...value,
          source: { ...value.source, [field]: alternatives[field] },
        } as PackageObservation;
      });
      await expect(
        captureRegionalPackage(
          { sourceId: 'atrativa-1823' },
          { allowNetwork: true },
          extract,
          async () => Buffer.from('<p>Synthetic</p>'),
        ),
      ).rejects.toThrow('PACKAGE_CAPTURE_SOURCE_BINDING_REJECTED');
    },
  );

  it('drops unsupported bridge shapes and never reflects transport payloads', async () => {
    const extract = vi.fn(async () => []) as never;
    await expect(
      captureRegionalPackage(
        { sourceId: 'atrativa-1823' },
        { allowNetwork: true },
        extract,
        async () => Buffer.from('<p>Synthetic</p>'),
      ),
    ).rejects.toThrow('PACKAGE_CAPTURE_OBSERVATION_REJECTED');
    const reject = captureRegionalPackage(
      { sourceId: 'atrativa-1823' },
      { allowNetwork: true },
      undefined,
      async () => {
        throw new Error('SYNTHETIC_PRIVATE_BODY');
      },
    );
    await expect(reject).rejects.toThrow('PACKAGE_CAPTURE_TRANSPORT_FAILED');
  });

  it('uses the real Python Niel parser rather than the first or lowest Node price candidate', async () => {
    const raw = Buffer.from(
      fixture('niel_detail').replace('<body>', '<body><p>Extra opcional R$4</p>'),
    );
    const result = await captureRegionalPackage(
      { sourceId: 'niel-aracaju-reveillon' },
      { allowNetwork: true },
      undefined,
      async () => raw,
    );
    expect(result.result.price.amountMinor).toBe(234567);
    expect(result.result.schemaVersion).toBe('package-observation/1');
    expect(result.result.source.site).toBe('niel');
    expect(result.factsVerified).toBe(false);
  }, 30000);

  it('parses a complete CLI page above 300 KiB without truncating its literal price', async () => {
    const raw = Buffer.from(
      fixture('niel_detail').replace('<body>', '<body><!--' + 'x'.repeat(310_000) + '-->'),
    );
    expect(raw.byteLength).toBeGreaterThan(300 * 1024);
    const result = await captureRegionalPackage(
      { sourceId: 'niel-aracaju-reveillon' },
      { allowNetwork: true },
      undefined,
      async () => raw,
    );
    expect(result.result.price.amountMinor).toBe(234567);
    expect(result.result.source.contentSha256).toBe(hash(raw));
    expect(result.sourceSha256).toBe(hash(raw));
  }, 30000);

  it('keeps unknown years and missing prices unknown across the child-process boundary', async () => {
    const raw = Buffer.from('<html><h1>Pacote sintético 24 a 27/12</h1><p>Saída: 24/12</p></html>');
    const result = await captureRegionalPackage(
      { sourceId: 'atrativa-1823' },
      { allowNetwork: true },
      undefined,
      async () => raw,
    );
    expect(result.result.departure.yearStated).toBe(false);
    expect(result.result.price.amountMinor).toBeNull();
    expect(result.result.lodging.name).toBeNull();
    expect(result.factsVerified).toBe(false);
  }, 30000);
});
