import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { plan } from '../api/src/planning.js';
import { prepareWorkflow } from '../agent/workflow.js';

// Synthetic regressions for defects confirmed during the v0.4 audit.
type Scenario = Record<string, unknown>;
const groupInput = (scenario: Scenario = {}, households?: unknown[]) => ({
  currency: 'BRL',
  evaluatedAt: '2030-01-01T12:30:00Z',
  households: households ?? [
    { id: 'N01', participants: ['P01'], ceilingMinor: 100000, cashLimitMinor: null },
  ],
  scenarios: [
    {
      id: 's1',
      destination: 'Synthetic destination',
      model: 'collective',
      scope: 'synthetic scope',
      nights: 2,
      constraintsConfirmed: true,
      capacityConfirmed: true,
      validUntil: '2030-02-01T00:00:00Z',
      costs: [
        {
          id: 'c1',
          label: 'lodging',
          lowMinor: 50000,
          highMinor: 50000,
          source: {
            id: 'src',
            url: null,
            observedAt: '2030-01-01T12:00:00Z',
            status: 'observed',
            note: 'synthetic',
          },
          acceptedRule: true,
          shares: [{ householdId: 'N01', weight: 1 }],
        },
      ],
      cashFlows: [],
      ...scenario,
    },
  ],
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const group = (input: unknown): any => (plan('group-split', input).result as any).scenarios[0];
const cost = (patch: Record<string, unknown>) => ({
  ...(groupInput().scenarios[0]!.costs[0] as Record<string, unknown>),
  ...patch,
});

describe('group split audit regressions', () => {
  it('keeps the baseline observed fixed amount within declared ceilings', () => {
    const s = group(groupInput());
    expect(s.ledger[0].status).toBe('documented');
    expect(s.status).toBe('within_declared_ceilings');
  });

  it('labels fixed amounts from non-observed sources as unconfirmed, not documented', () => {
    for (const status of ['declared', 'indicative', 'historical']) {
      const input = groupInput({
        costs: [cost({ source: { ...(cost({}).source as object), status } })],
      });
      const s = group(input);
      expect(s.ledger[0].status).toBe('unconfirmed_amount');
      expect(s.status).toBe('conditional');
    }
  });

  it('does not certify a scenario priced from a source observed after evaluation', () => {
    const input = groupInput({
      costs: [
        cost({ source: { ...(cost({}).source as object), observedAt: '2031-06-01T00:00:00Z' } }),
      ],
    });
    expect(group(input).status).toBe('conditional');
  });

  it('counts a card hold in the same-instant exposure against the cash limit', () => {
    const input = groupInput(
      {
        cashFlows: [
          {
            id: 'f1',
            householdId: 'N01',
            at: '2030-01-10T10:00:00Z',
            amountMinor: 80000,
            kind: 'payment',
          },
          {
            id: 'f2',
            householdId: 'N01',
            at: '2030-01-10T10:00:00Z',
            amountMinor: 50000,
            kind: 'card_hold',
          },
        ],
      },
      [{ id: 'N01', participants: ['P01'], ceilingMinor: 100000, cashLimitMinor: 100000 }],
    );
    const s = group(input);
    expect(s.households[0].peakCashMinor).toBe(80000);
    expect(s.households[0].peakCardHoldMinor).toBe(50000);
    expect(s.households[0].peakExposureMinor).toBe(130000);
    expect(s.households[0].cashWithinLimit).toBe(false);
    expect(s.status).toBe('ineligible');
  });

  it('rejects deposit returns and refunds without the matching prior exposure', () => {
    const flows = (kind: string, prior: string) =>
      groupInput({
        cashFlows: [
          {
            id: 'f1',
            householdId: 'N01',
            at: '2030-01-10T10:00:00Z',
            amountMinor: 50000,
            kind: prior,
          },
          { id: 'f2', householdId: 'N01', at: '2030-01-11T10:00:00Z', amountMinor: 30000, kind },
        ],
      });
    expect(() => group(flows('deposit_return', 'payment'))).toThrow('CASH_RETURN_WITHOUT_EXPOSURE');
    expect(() => group(flows('refund', 'deposit'))).toThrow('CASH_RETURN_WITHOUT_EXPOSURE');
    const valid = group(flows('deposit_return', 'deposit'));
    expect(valid.households[0].peakCashMinor).toBe(50000);
  });

  it('does not treat a household absent from every cost line as a zero-cost certainty', () => {
    const input = groupInput({}, [
      { id: 'N01', participants: ['P01'], ceilingMinor: 100000, cashLimitMinor: null },
      { id: 'N02', participants: ['P02', 'P03'], ceilingMinor: 1, cashLimitMinor: null },
    ]);
    const s = group(input);
    expect(s.households[1].hasCostLines).toBe(false);
    expect(s.status).toBe('conditional');
  });

  it('keeps sourced amounts in the known group cost while the split rule is undecided', () => {
    const s = group(
      groupInput({ costs: [cost({ lowMinor: 150000, highMinor: 150000, acceptedRule: false })] }),
    );
    expect(s.groupKnownCost).toEqual({ lowMinor: 150000, highMinor: 150000 });
    expect(s.groupFinalCost).toBeNull();
    expect(s.households[0].finalCost).toBeNull();
  });
});

describe('planning tool audit regressions', () => {
  const example = (name: string) =>
    JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));

  it('rejects duplicate fare-scenario option identifiers', () => {
    const input = example('fare-scenarios');
    input.options = [input.options[0], { ...input.options[0], changeFeeMinor: 1 }];
    expect(() => plan('fare-scenarios', input)).toThrow('DUPLICATE_OPTION');
  });

  it('explains why a hidden-city nominal difference is unavailable', () => {
    const input = example('hidden-city');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = plan('hidden-city', input).result as any;
    expect(Object.hasOwn(result, 'differenceReason')).toBe(true);
    if (result.nominalDifferenceMinor === null)
      expect(typeof result.differenceReason).toBe('string');
    else expect(result.differenceReason).toBeNull();
  });

  it('requires the passenger configuration and group budget that the route prompt makes mandatory', () => {
    const base = {
      language: 'pt-BR',
      tripKey: 'trip-synthetic-001',
      workflowId: 'connections',
      suppliedFields: ['route_context', 'supplier_terms'],
    };
    const partial = prepareWorkflow(base);
    expect(partial.state).not.toBe('ready_for_documentary_review');
    expect(partial.missingFields).toEqual(
      expect.arrayContaining(['party_profile', 'budget_scope']),
    );
    for (const workflowId of [
      'airports',
      'promotions',
      'total-cost',
      'fare-scenarios',
      'hidden-city',
    ])
      expect(() =>
        prepareWorkflow({ ...base, workflowId, suppliedFields: ['party_profile'] }),
      ).not.toThrow();
  });
});
