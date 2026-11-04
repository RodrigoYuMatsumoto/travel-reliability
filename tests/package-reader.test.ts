import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { gzipSync } from 'node:zlib';
import {
  decodePackageHtml,
  PACKAGE_READER_LIMITS,
  readPackageHtml,
} from '../agent/package-reader.js';
import { packageSourceUrl } from '../agent/package-sources.js';

const io = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: io.lookup }));
vi.mock('node:https', () => ({ request: io.request }));

function mockHttps(
  options: {
    status?: number;
    headers?: Record<string, string | undefined>;
    chunks?: Buffer[];
    complete?: boolean;
    hang?: boolean;
  } = {},
) {
  io.request.mockImplementation((_url, _options, callback) => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: options.status ?? 200,
      headers: { 'content-type': 'text/html; charset=utf-8', ...options.headers },
      complete: options.complete ?? true,
      destroyed: false,
      destroy() {
        this.destroyed = true;
        return this;
      },
    });
    const req = Object.assign(new EventEmitter(), {
      destroyed: false,
      destroy() {
        this.destroyed = true;
        return this;
      },
      end() {
        queueMicrotask(() => {
          if (options.hang || this.destroyed) return;
          callback(response);
          for (const chunk of options.chunks ?? [
            Buffer.from('<html><p>Ônibus incluído</p></html>'),
          ])
            if (!response.destroyed) response.emit('data', chunk);
          if (!response.destroyed) {
            response.emit('end');
            response.emit('close');
          }
        });
        return this;
      },
    });
    return req;
  });
}
// Extraction belongs to the Python package extractor (tests/package-capture.test.ts and
// ingest/tests). This file covers only the bounded HTTPS read and byte decoding.
describe('fixed-reference HTTPS package reader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    io.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('rejects arbitrary URLs, duplicate queries, altered tenants, credentials, ports and hash roots before DNS', async () => {
    for (const url of [
      'https://127.0.0.1/',
      'http://atrativatur.com.br/viagem.php?v=1822',
      'https://atrativatur.com.br.evil.invalid/viagem.php?v=1822',
      ['https://synthetic:fake-secret', 'atrativatur.com.br/viagem.php?v=1822'].join('@'),
      'https://atrativatur.com.br:444/viagem.php?v=1822',
      'https://atrativatur.com.br/viagem.php?v=1822&v=1823',
      'https://nielturismo.suareservaonline.com.br/pacote/morro-de-sao-paulo-uid146/44052',
      'https://augustusturismo.com.br/#/pacote/reveillon-morro-de-sao-paulo-1299-2026-12-30',
      'https://augustusturismo.com.br/',
    ])
      await expect(readPackageHtml(new URL(url))).rejects.toThrow('SOURCE_REJECTED');
    expect(io.lookup).not.toHaveBeenCalled();
    expect(io.request).not.toHaveBeenCalled();
  });
  it('rejects private or mixed DNS answers without an HTTP request', async () => {
    for (const addresses of [
      [{ address: '127.0.0.1', family: 4 }],
      [
        { address: '8.8.8.8', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      [{ address: '::1', family: 6 }],
      [],
    ]) {
      io.lookup.mockResolvedValue(addresses);
      await expect(readPackageHtml(packageSourceUrl('atrativa-1822'))).rejects.toThrow(
        'ADDRESS_REJECTED',
      );
    }
    expect(io.request).not.toHaveBeenCalled();
  });
  it('pins approved DNS and uses cookie-free HTTPS with no redirect followup', async () => {
    mockHttps();
    await expect(readPackageHtml(packageSourceUrl('atrativa-1822'))).resolves.toBeInstanceOf(
      Uint8Array,
    );
    const opts = io.request.mock.calls[0]![1];
    expect(opts).toMatchObject({
      method: 'GET',
      agent: false,
      rejectUnauthorized: true,
      servername: 'atrativatur.com.br',
    });
    expect(opts.headers).not.toHaveProperty('cookie');
    const callback = vi.fn();
    opts.lookup('atrativatur.com.br', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '8.8.8.8', 4);
    io.request.mockClear();
    mockHttps({ status: 302, headers: { location: 'https://evil.invalid' } });
    await expect(readPackageHtml(packageSourceUrl('atrativa-1822'))).rejects.toThrow(
      'HTTP_REJECTED',
    );
    expect(io.request).toHaveBeenCalledTimes(1);
  });
  it('bounds response bytes, decompression, type and incomplete bodies', async () => {
    for (const options of [
      { headers: { 'content-type': 'application/json' } },
      { headers: { 'content-encoding': 'br' } },
      { headers: { 'content-length': '1000001' } },
      { chunks: [Buffer.alloc(1000001)] },
      { headers: { 'content-encoding': 'gzip' }, chunks: [gzipSync(Buffer.alloc(1000001))] },
      { complete: false },
    ]) {
      mockHttps(options);
      await expect(readPackageHtml(packageSourceUrl('atrativa-1822'))).rejects.toThrow();
    }
  });
  it('applies timeouts with no automatic retries', async () => {
    vi.useFakeTimers();
    mockHttps({ hang: true });
    const promise = readPackageHtml(packageSourceUrl('atrativa-1822'));
    const expectation = expect(promise).rejects.toThrow('HTTP_TIMEOUT');
    await vi.advanceTimersByTimeAsync(PACKAGE_READER_LIMITS.httpMs + 1);
    await expectation;
    expect(io.request).toHaveBeenCalledTimes(1);
    io.request.mockClear();
    io.lookup.mockImplementation(() => new Promise(() => {}));
    const dns = readPackageHtml(packageSourceUrl('atrativa-1822'));
    const dnsExpectation = expect(dns).rejects.toThrow('DNS_TIMEOUT');
    await vi.advanceTimersByTimeAsync(PACKAGE_READER_LIMITS.dnsMs + 1);
    await dnsExpectation;
    expect(io.request).not.toHaveBeenCalled();
  });
  it('rejects malformed UTF-8, replacement characters and oversized bodies before extraction', () => {
    expect(() => decodePackageHtml(Buffer.from([0xff]))).toThrow();
    expect(() => decodePackageHtml(Buffer.alloc(1_000_001))).toThrow('RESPONSE_LIMIT');
    expect(() => decodePackageHtml(Buffer.from('<html><p>Tarifa �</p></html>'))).toThrow(
      'ENCODING_REJECTED',
    );
  });
  it('decodes declared legacy charset without silent replacement and rejects unsupported or conflicting encodings', async () => {
    const legacy = Buffer.from(
      '<html><meta charset="iso-8859-1"><p>Café da manhã incluído</p></html>',
      'latin1',
    );
    expect(decodePackageHtml(legacy)).toMatchObject({
      sourceEncoding: 'windows-1252',
      html: expect.stringContaining('Café da manhã incluído'),
    });
    mockHttps({
      headers: { 'content-type': 'text/html; charset=windows-1252' },
      chunks: [Buffer.from('<html><p>Café da manhã incluído</p></html>', 'latin1')],
    });
    const read = await readPackageHtml(packageSourceUrl('atrativa-1822'));
    expect(decodePackageHtml(read)).toMatchObject({
      sourceEncoding: 'windows-1252',
      html: expect.stringContaining('Café da manhã incluído'),
    });
    mockHttps({ headers: { 'content-type': 'text/html; charset=utf-8' }, chunks: [legacy] });
    const conflicting = await readPackageHtml(packageSourceUrl('atrativa-1822'));
    expect(() => decodePackageHtml(conflicting)).toThrow('ENCODING_REJECTED');
    mockHttps({ headers: { 'content-type': 'text/html; charset=utf-16' } });
    await expect(readPackageHtml(packageSourceUrl('atrativa-1822'))).rejects.toThrow(
      'ENCODING_REJECTED',
    );
  });
});
