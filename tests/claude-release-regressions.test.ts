import { describe, expect, it } from 'vitest';
import { extractText } from '../api/src/ingestion.js';
import { plan } from '../api/src/planning.js';
import { enforceContentPolicy } from '../agent/content-policy.js';
import { input } from '../api/src/input-schemas.js';
import example from '../examples/total-cost.json' with { type: 'json' };

describe('release readiness regressions', () => {
  it('keeps a literal extraction span even when the field occurs after 600 characters', () => {
    const extracted = extractText(Buffer.from('X'.repeat(800) + ' baggage is included.'));
    expect(extracted.fields).toHaveLength(1);
    const field = extracted.fields[0]!;
    expect(field.source.quote).toContain(field.value);
    expect(field.source.quote.length).toBeLessThanOrEqual(600);
  });

  it('retains seconds in an explicitly supplied offer interval', () => {
    const data = structuredClone(example);
    data.offers[0]!.arrival = data.offers[0]!.arrival.replace(':00-03:00', ':30-03:00');
    const result = plan('total-cost', data).result as { rows: Array<{ durationMinutes: number }> };
    expect(result.rows[0]!.durationMinutes).toBe(120.5);
  });

  it('allows an ordinary English idiom independently of restricted recommendations', () => {
    expect(() =>
      enforceContentPolicy({ note: 'For the sake of consistency, use the same unit.' }),
    ).not.toThrow();
  });

  it('rejects an empty provenance claim or license even if the source URL is present', () => {
    const route = {
      title: 'Synthetic route',
      country: 'BR',
      seasonality: '',
      safetyNotes: '',
      alternative: '',
      segments: [
        {
          label: 'X01',
          mode: 'bus',
          durationMinutes: null,
          distanceKm: null,
          costMinor: null,
          currency: null,
          accessibility: 'unknown',
          supportPoints: [],
        },
      ],
      provenance: [
        {
          url: 'https://example.invalid/route',
          license: 'Public or cited license',
          checkedAt: '2026-11-19T00:00:00Z',
          claim: 'A synthetic statement.',
        },
      ],
    };
    expect(() => input('route', route)).not.toThrow();
    expect(() =>
      input('route', { ...route, provenance: [{ ...route.provenance[0], claim: ' ' }] }),
    ).toThrow();
    expect(() =>
      input('route', { ...route, provenance: [{ ...route.provenance[0], license: '' }] }),
    ).toThrow();
  });
});
