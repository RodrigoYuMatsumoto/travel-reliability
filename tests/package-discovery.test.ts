import { describe, it, expect } from 'vitest';
import { discoverPackages } from '../agent/package-discovery.js';
import {
  packageReferenceCatalog,
  packageSourceById,
  packageSourceUrl,
} from '../agent/package-sources.js';

const input = () => ({
  origin: 'Petrolina/PE',
  destination: null,
  windows: [
    { id: 'christmas', startDate: '2026-12-24', endDate: '2026-12-27' },
    { id: 'newyear', startDate: '2026-12-30', endDate: '2027-01-03' },
  ],
});
describe('offline bounded package discovery', () => {
  it.each(['origin', 'destination'] as const)(
    'rejects private or control text after compatibility normalization in %s',
    (field) => {
      for (const value of [
        'synthetic＠example.invalid',
        'Contato １２３４５６７８９０１',
        'Cidade\u2028Estado',
        'Cidade\u2029Estado',
        'Cidade\u200bEstado',
        'Cidade＜tag＞',
        'Contato ١٢٣٤٥٦٧٨٩٠١',
        '/--',
      ]) {
        expect(() => discoverPackages({ ...input(), [field]: value })).toThrow();
      }
      const result = discoverPackages({ ...input(), [field]: 'Ｓãｏ Ｐａｕｌｏ/SP' });
      expect(result[field]).toBe('São Paulo/SP');
    },
  );
  it('preserves all 24 operator-supplied references and paginates without network', () => {
    const first = discoverPackages({ ...input(), limit: 20 });
    const second = discoverPackages({ ...input(), limit: 20, cursor: first.nextCursor! });
    expect(first.total).toBe(24);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(4);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(({ sourceId }) => sourceId)).size).toBe(
      24,
    );
    expect(first).toMatchObject({
      externalCalls: 0,
      modelCalls: 0,
      factsVerified: false,
      supplierCertification: false,
    });
    expect(first.windows).toHaveLength(2);
  });
  it('filters providers, generates exact date catalog hints and keeps origin uncertain outside seed region', () => {
    const result = discoverPackages({
      ...input(),
      origin: 'São Paulo/SP',
      providerIds: ['atrativa'],
    });
    expect(result.total).toBe(5);
    expect(result.items.every((row) => row.originMatch === 'unconfirmed')).toBe(true);
    const url = new URL(result.searchHints[0]!.dateCatalogUrl!);
    expect(url.searchParams.get('data')).toBe('24/12/2026');
    expect(url.searchParams.get('local')).toBe('');
    expect(result.searchHints[1]!.windowId).toBe('newyear');
  });
  it('preserves fragments, product queries and ampersands in paths without treating them as verified dates', () => {
    expect(packageSourceById('augustus-morro-reveillon')).toMatchObject({
      fetchUrl: null,
      access: 'rendered_snapshot',
    });
    expect(new URL(packageSourceById('augustus-morro-reveillon').browserUrl).hash).toContain(
      '/pacote/',
    );
    expect(new URL(packageSourceUrl('atrativa-1822')).search).toBe('?v=1822');
    const valle = new URL(packageSourceById('valle-aracaju-christmas').browserUrl);
    expect(valle.pathname).toContain('&');
    expect(valle.search).toBe('');
    expect(() => packageSourceUrl('augustus-morro-reveillon')).toThrow('ASSISTED');
    expect(() => packageSourceUrl('niel-instagram')).toThrow('ASSISTED');
    expect(discoverPackages(input()).items.every((row) => row.dateStatus === 'not_verified')).toBe(
      true,
    );
    expect(packageReferenceCatalog.some((row) => 'price' in row)).toBe(false);
  });
  it('rejects malformed windows, repeated IDs, extra authority, personal identifiers and empty city names', () => {
    for (const candidate of [
      { ...input(), windows: [{ id: 'bad', startDate: '2026-12-30', endDate: '2026-12-24' }] },
      { ...input(), windows: [input().windows[0], input().windows[0]] },
      { ...input(), windows: [{ id: 'bad', startDate: '2026-02-30', endDate: '2026-03-03' }] },
      { ...input(), allowNetwork: true },
      { ...input(), origin: 'person@example.invalid' },
      { ...input(), origin: 'Rua Synthetic' },
      { ...input(), origin: '   ' },
      { ...input(), cursor: 100 },
      { ...input(), limit: 21 },
      { ...input(), providerIds: ['unknown'] },
    ])
      expect(() => discoverPackages(candidate)).toThrow();
  });
  it('rejects proxies and accessors without evaluating them', () => {
    let calls = 0;
    const accessor = Object.defineProperty(input(), 'origin', {
      enumerable: true,
      get() {
        calls++;
        return 'Petrolina';
      },
    });
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf() {
          calls++;
          return Object.prototype;
        },
      },
    );
    expect(() => discoverPackages(accessor)).toThrow();
    expect(() => discoverPackages(proxy)).toThrow();
    expect(calls).toBe(0);
  });
});
