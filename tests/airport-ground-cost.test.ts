import { describe, it, expect } from 'vitest';
import { plan } from '../api/src/planning.js';
import { planningExamples } from '../web/src/planning-examples.js';
import type { ComparisonInput, CostItem, Offer } from '../schema/src/planning.js';

// Synthetic door-to-door comparisons between two airports serving the same trip.
const cost = (id: string, unitMinor: number): CostItem => ({
  id,
  label: id,
  unit: 'group',
  quantity: 1,
  unitMinor,
  currency: 'BRL',
  treatment: 'necessary',
  selected: true,
  sourceIds: ['source-a'],
});
function input(patch: { base?: Partial<Offer>; candidate?: Partial<Offer> } = {}) {
  const value = structuredClone(planningExamples.airports) as ComparisonInput;
  const template = value.offers[0]!;
  template.sources = [{ ...template.sources[0]!, status: 'observed' }];
  template.validUntil = '2030-01-02T00:00:00Z';
  template.capacityConfirmed = true;
  const base: Offer = {
    ...template,
    id: 'offer-near',
    airport: 'BBB',
    costs: [cost('fare', 120000), cost('taxi', 15000)],
    groundCostIds: ['taxi'],
    ...patch.base,
  };
  const candidate: Offer = {
    ...template,
    id: 'offer-far',
    airport: 'CCC',
    costs: [cost('fare', 100000), cost('coach', 30000)],
    groundCostIds: ['coach'],
    ...patch.candidate,
  };
  value.offers = [base, candidate];
  value.baselineId = 'offer-near';
  value.allowedAirports = ['BBB', 'CCC'];
  return value;
}
const rows = (value: ComparisonInput) =>
  (
    plan('airports', value).result as {
      rows: Array<{
        id: string;
        pending: string[];
        difference: { savingsMinor: number | null; reason: string | null };
      }>;
    }
  ).rows;
const far = (value: ComparisonInput) => rows(value).find((r) => r.id === 'offer-far')!;

describe('airport door-to-door ground cost', () => {
  it('compares airports including the declared ground access lines', () => {
    const row = far(input());
    expect(row.pending).not.toContain('GROUND_COST_UNCONFIRMED');
    expect(row.difference).toMatchObject({ savingsMinor: 5000, reason: null });
  });
  it('does not show savings while an airport offer leaves ground cost unconfirmed', () => {
    const value = input();
    delete value.offers[1]!.groundCostIds;
    value.offers[1]!.costs = [cost('fare', 100000)];
    const row = far(value);
    expect(row.pending).toContain('GROUND_COST_UNCONFIRMED');
    expect(row.difference).toEqual({ savingsMinor: null, reason: 'GROUND_COST_UNCONFIRMED' });
    const baseline = input();
    delete baseline.offers[0]!.groundCostIds;
    expect(far(baseline).difference.reason).toBe('GROUND_COST_UNCONFIRMED');
  });
  it('accepts an explicit statement that no ground cost applies', () => {
    const row = far(input({ candidate: { costs: [cost('fare', 100000)], groundCostIds: [] } }));
    expect(row.pending).not.toContain('GROUND_COST_UNCONFIRMED');
    expect(row.difference).toMatchObject({ savingsMinor: 35000 });
  });
  it('flags ground lines left out of the total and rejects unknown or repeated ids', () => {
    const optional = { ...cost('coach', 30000), treatment: 'optional' as const, selected: false };
    const row = far(input({ candidate: { costs: [cost('fare', 100000), optional] } }));
    expect(row.pending).toContain('GROUND_COST_NOT_COUNTED');
    expect(row.difference.savingsMinor).toBeNull();
    expect(() => plan('airports', input({ candidate: { groundCostIds: ['missing'] } }))).toThrow(
      'GROUND_COST_NOT_FOUND',
    );
    expect(() =>
      plan('airports', input({ candidate: { groundCostIds: ['coach', 'coach'] } })),
    ).toThrow('DUPLICATE_GROUND_COST');
  });
  it('keeps other comparison tools unchanged', () => {
    const value = input();
    delete value.offers[1]!.groundCostIds;
    const total = (plan('total-cost', value).result as { rows: Array<{ pending: string[] }> }).rows;
    expect(total.every((r) => !r.pending.includes('GROUND_COST_UNCONFIRMED'))).toBe(true);
  });
});
