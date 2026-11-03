import { describe, expect, it } from 'vitest';
import { benchmarkDocumentary, nearestRankPercentile } from '../scripts/benchmark-documentary.js';

describe('documentary benchmark evidence', () => {
  it('executes all calculators, rejects missing input, and distinguishes bytes from tokens', () => {
    const report = benchmarkDocumentary(2);
    expect(report.calculators).toHaveLength(11);
    expect(report.executions).toBe(22);
    expect(report.latencyMethod).toMatchObject({
      percentile: 'nearest-rank',
      samplesPerCalculator: 2,
      confidenceInterval: null,
    });
    expect(report.dataset).toContain('no real travelers or user pilot');
    expect(report.measurements).toEqual({
      payloadUnit: 'UTF-8 bytes',
      tokenizer: null,
      tokenSavingsClaimed: false,
    });
    for (const row of report.calculators) {
      expect(row.modelCalls).toBe(0);
      expect(row.networkCalls).toBe(0);
      expect(row.invalidInputRejected).toBe(true);
      expect(row.selectedPromptBytes).toBeLessThan(report.fullPromptBytes);
      expect(row.p95Ms).toBeGreaterThanOrEqual(0);
      expect(row.p95Ms).toBeGreaterThanOrEqual(row.p50Ms);
    }
  });
  it('does not allow an unbounded execution request', () => {
    expect(() => benchmarkDocumentary(1001)).toThrow('BENCHMARK_REPETITIONS_REJECTED');
  });
  it('uses a declared nearest-rank percentile and rejects invalid samples', () => {
    const values = Array.from({ length: 25 }, (_, index) => index + 1);
    expect(nearestRankPercentile(values, 0.95)).toBe(24);
    expect(nearestRankPercentile([...values].reverse(), 0.5)).toBe(13);
    expect(nearestRankPercentile([9], 0.95)).toBe(9);
    for (const invalid of [[], [Number.NaN], [-1]])
      expect(() => nearestRankPercentile(invalid, 0.95)).toThrow('BENCHMARK_SAMPLE_REJECTED');
  });
});
