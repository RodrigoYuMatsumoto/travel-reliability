import { describe, expect, it } from 'vitest';
import graph from '../data/loyalty_graph.json' with { type: 'json' };
import { loyaltyArbitrage } from '../api/src/loyalty-arbitrage.js';
import { multimodalStitching } from '../api/src/multimodal-stitching.js';
import { loyaltyExample, multimodalExample } from '../web/src/intelligence-examples.js';
import {
  auditClaims,
  digest,
  passiveJson,
  receipt,
  type EvidenceReference,
} from '../agent/provenance.js';
import { countryContext } from '../agent/country-packs.js';
import { enforceContentPolicy } from '../agent/content-policy.js';
import { plan } from '../api/src/planning.js';

const eligible = [
  'same_holder',
  'centurion_points',
  'active_accounts',
  'eligible_itau_points',
  'linked_accounts',
  'account_age_30_days',
  'club_esfera',
].map((code) => ({ code, value: 'yes' }));
const input = () => ({
  ...structuredClone(loyaltyExample),
  eligibility: structuredClone(eligible),
});
const routes = (value: ReturnType<typeof loyaltyArbitrage>) =>
  value.routes as Array<{
    path: string[];
    netPointsReceived: number;
    declaredAcquisitionCostMinor: number | null;
    effectiveCpmMinorPer1000: number | null;
    awardTotalEconomicCostMinor: number | null;
    declaredSavingsMinor: number | null;
    hops: Array<{ outputPoints: number }>;
  }>;
const evidence = (): EvidenceReference => ({
  id: 'E-SYNTHETIC',
  sourceUrl: 'https://example.invalid/synthetic-evidence',
  sourceSha256: 'a'.repeat(64),
  retrievedAt: '2026-11-03T10:00:00Z',
  reviewAfter: '2026-11-10T10:00:00Z',
  state: 'reviewed',
  sourceSpan: { quote: 'Synthetic claim only.', locator: 'synthetic:1' },
  assertion: { subject: 'SYNTHETIC', predicate: 'test.value', value: 7 },
});
describe('bounded loyalty calculation', () => {
  it('rejects the restricted direct edge while preserving a separately eligible indirect path', () => {
    const result = loyaltyArbitrage(loyaltyExample);
    expect(result.rejectedEdges).toContainEqual({
      edgeId: 'LIVELO-CENTURION-TAP',
      code: 'EDGE_INELIGIBLE',
    });
    expect(routes(result)).toContainEqual(
      expect.objectContaining({
        path: ['LIVELO', 'ALL', 'TAP'],
        netPointsReceived: 2000,
        declaredAcquisitionCostMinor: 28000,
        effectiveCpmMinorPer1000: 14000,
        awardTotalEconomicCostMinor: 38000,
        declaredSavingsMinor: null,
      }),
    );
    expect(result.factsVerified).toBe(false);
  });
  it('requires personal eligibility without treating an absent edge as a universal prohibition', () => {
    expect(
      routes(
        loyaltyArbitrage({
          ...input(),
          sourceProgram: 'ITAU',
          targetProgram: 'LIVELO',
          sourcePoints: 30000,
        }),
      ),
    ).toEqual([]);
    const missing = loyaltyArbitrage({ ...input(), eligibility: [] });
    expect(routes(missing)).toEqual([]);
    expect(missing.rejectedEdges.some((r) => r.code === 'EDGE_ELIGIBILITY_UNKNOWN')).toBe(true);
  });
  it('routes Iberia to Qatar through BA without inventing a direct link', () => {
    expect(
      routes(
        loyaltyArbitrage({
          ...input(),
          sourceProgram: 'IBERIA',
          targetProgram: 'QATAR',
          sourcePoints: 10000,
        }),
      )[0]!.path,
    ).toEqual(['IBERIA', 'BA', 'QATAR']);
  });
  it('counts purchased cart points once and does not value owned points at zero', () => {
    const result = loyaltyArbitrage({
      ...input(),
      sourcePoints: 9000,
      topUp: { points: 1000, cashMinor: 5000 },
    });
    const direct = routes(result).find((r) => r.path.length === 2)!;
    expect(direct.netPointsReceived).toBe(10000);
    expect(direct.declaredAcquisitionCostMinor).toBe(23000);
    expect(direct.effectiveCpmMinorPer1000).toBe(2300);
    expect(() => loyaltyArbitrage({ ...input(), acquisitionCostPer1000Minor: 0 })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    expect(
      routes(loyaltyArbitrage({ ...input(), acquisitionCostPer1000Minor: null }))[0]!
        .effectiveCpmMinorPer1000,
    ).toBeNull();
    const purchased = routes(
      loyaltyArbitrage({
        ...input(),
        sourcePoints: 0,
        acquisitionCostPer1000Minor: null,
        topUp: { points: 1000, cashMinor: 5000 },
      }),
    )[0]!;
    expect(purchased.declaredAcquisitionCostMinor).toBe(5000);
  });
  it('applies the exact conversion/bonus floor at each hop and retains bounded exploration', () => {
    const synthetic = structuredClone(graph);
    synthetic.synthetic = true;
    synthetic.programs = ['A', 'B', 'C'];
    const template = synthetic.edges[0]!;
    synthetic.edges = ['AB', 'BC', 'BA'].map((id, index) => ({
      ...template,
      id,
      source_program: index === 0 ? 'A' : 'B',
      target_program: index === 0 ? 'B' : index === 1 ? 'C' : 'A',
      base_ratio: { sourceUnits: 3, targetUnits: 2 },
      eligibility_constraint: [],
      min_transfer_points: 1,
      transfer_bonus_bps: 1000,
    }));
    const result = loyaltyArbitrage(
      { ...input(), sourceProgram: 'A', targetProgram: 'C', sourcePoints: 7 },
      synthetic,
    );
    expect(routes(result)[0]!.hops.map((h) => h.outputPoints)).toEqual([5, 3]);
    expect(result.expansions).toBeLessThan(10);
    expect(loyaltyArbitrage({ ...input(), maxExpansions: 1 }).truncated).toBe(true);
  });
  it('enforces lots, target caps, unknown ratios and duplicate IDs', () => {
    const lots = loyaltyArbitrage({ ...loyaltyExample, sourcePoints: 15000 });
    expect(lots.rejectedEdges.some((r) => r.code === 'TRANSFER_LOT_REJECTED')).toBe(true);
    const caps = loyaltyArbitrage({
      ...input(),
      sourceProgram: 'ESFERA',
      targetProgram: 'TAP',
      sourcePoints: 300000,
    });
    expect(caps.rejectedEdges.some((r) => r.code === 'TARGET_LIMIT_EXCEEDED')).toBe(true);
    expect(
      loyaltyArbitrage({ ...input(), targetProgram: 'UNITED' }).rejectedEdges.some(
        (r) => r.code === 'EDGE_RATIO_UNKNOWN',
      ),
    ).toBe(true);
    const duplicate = structuredClone(graph);
    duplicate.edges.push(duplicate.edges[0]!);
    expect(() => loyaltyArbitrage(input(), duplicate)).toThrow('INTELLIGENCE_DUPLICATE_ID');
  });
  it('rejects extra host bonus fields, malformed inputs and unknown dispatch IDs', () => {
    expect(() => loyaltyArbitrage({ ...input(), bonusBps: 10000 })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    expect(() => loyaltyArbitrage({ ...input(), sourcePoints: null })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    expect(() => plan('unregistered-calculator', {})).toThrow();
    expect(plan('loyalty-arbitrage', loyaltyExample)).toHaveProperty('audit.factsVerified', false);
  });
});

describe('multimodal schedules and uncertainty', () => {
  it('stitches supplied air and bus legs with explicit self-transfer buffers', () => {
    const result = multimodalStitching(multimodalExample);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      legIds: ['LEG-A', 'LEG-B'],
      completeTotalMinor: 25000,
      status: 'conditional',
      connections: [
        { waitMinutes: 240, requiredMinutes: 165, protection: 'self_transfer', node: 'NODE-B' },
      ],
    });
    expect(result.calculationReceipt.inputSha256).toBe(digest(multimodalExample));
  });
  it('rejects an impossible buffer without inventing terminal changes', () => {
    const sample = structuredClone(multimodalExample);
    sample.legs[1]!.departure.local = '2026-11-04T11:00:00';
    expect(multimodalStitching(sample).candidates).toHaveLength(0);
    const unrelated = structuredClone(multimodalExample);
    unrelated.nodes.push({
      id: 'OTHER-TERMINAL',
      minimumConnectionMinutes: 45,
      timeZone: 'America/Sao_Paulo',
      country: 'BR',
    });
    unrelated.legs[1]!.origin = 'OTHER-TERMINAL';
    expect(multimodalStitching(unrelated).candidates).toHaveLength(0);
  });
  it('rejects DST ambiguity and future source timestamps', () => {
    for (const local of ['2026-03-08T02:30:00', '2026-11-01T01:30:00']) {
      const sample = structuredClone(multimodalExample);
      sample.legs[0]!.departure = { local, timeZone: 'America/New_York' };
      sample.nodes[0]!.timeZone = 'America/New_York';
      expect(() => multimodalStitching(sample)).toThrow('ROUTE_TIME_REJECTED');
    }
    const sample = structuredClone(multimodalExample);
    sample.sources[0]!.observedAt = '2026-11-04T10:00:00Z';
    expect(() => multimodalStitching(sample)).toThrow('ROUTE_FUTURE_SOURCE');
  });
  it('preserves mixed currencies, missing buffers and hidden-city warnings', () => {
    const sample = structuredClone(multimodalExample);
    sample.legs[1]!.currency = 'USD';
    sample.legs[1]!.hiddenCity = true;
    sample.separateTicketBufferMinutes = null as unknown as number;
    const route = multimodalStitching(sample).candidates[0]!;
    expect(route.completeTotalMinor).toBeNull();
    expect(route.knownTotals).toEqual({ BRL: 20000, USD: 5000 });
    expect(route.gaps).toContain('CONNECTION_BUFFER_UNKNOWN');
    expect(route.gaps).toContain('HIDDEN_CITY_CONTRACT_AND_BAGGAGE_REVIEW');
  });
});

describe('typed evidence and country context', () => {
  it('does not execute getters/proxies or accept arbitrary object instances', () => {
    let touched = false;
    const accessor = Object.defineProperty({}, 'data', {
      enumerable: true,
      get: () => {
        touched = true;
        return 1;
      },
    });
    expect(() => passiveJson(accessor)).toThrow('PASSIVE_DATA_REQUIRED');
    expect(touched).toBe(false);
    const proxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          touched = true;
          return Object.prototype;
        },
      },
    );
    expect(() => passiveJson(proxy)).toThrow('PASSIVE_DATA_REQUIRED');
    expect(touched).toBe(false);
    expect(() => passiveJson(new Date())).toThrow('PASSIVE_DATA_REQUIRED');
  });
  it('binds exact typed assertions, freshness and independent operator registration', () => {
    const ref = evidence();
    const claim = {
      id: 'C1',
      subject: 'SYNTHETIC',
      predicate: 'test.value',
      value: 7,
      kind: 'fact',
      evidenceRefs: [ref.id],
      calculationRef: null,
    };
    const packet = { evaluatedAt: '2026-11-03T12:00:00Z', claims: [claim] };
    expect(auditClaims(packet, [ref]).results[0]!.status).toBe('documented');
    expect(auditClaims(packet, []).approved).toBe(false);
    expect(auditClaims({ ...packet, claims: [{ ...claim, value: 8 }] }, [ref]).approved).toBe(
      false,
    );
    expect(auditClaims({ ...packet, evaluatedAt: '2026-12-03T12:00:00Z' }, [ref]).approved).toBe(
      false,
    );
    expect(auditClaims(packet, [{ ...ref, state: 'conflicting' }]).approved).toBe(false);
    expect(
      auditClaims({ ...packet, claims: [{ ...claim, kind: 'hypothesis' }] }, []).results[0]!.status,
    ).toBe('hypothesis');
  });
  it('rejects a forged calculation receipt and preserves the distinction from factual truth', () => {
    const a = { points: 3 },
      b = { result: 7 },
      evaluatedAt = '2026-11-03T12:00:00Z';
    const rec = receipt('synthetic', a, b, evaluatedAt);
    const packet = {
      evaluatedAt,
      claims: [
        {
          id: 'C1',
          subject: 'synthetic',
          predicate: 'result',
          value: b,
          kind: 'calculation',
          evidenceRefs: [],
          calculationRef: rec.outputSha256,
        },
      ],
    };
    expect(
      auditClaims(packet, [], new Map([[rec.outputSha256, { receipt: rec, input: a, output: b }]]))
        .results[0]!.status,
    ).toBe('calculation_bound');
    expect(
      auditClaims(
        packet,
        [],
        new Map([[rec.outputSha256, { receipt: rec, input: a, output: { result: 8 } }]]),
      ).approved,
    ).toBe(false);
  });
  it('keeps territorial conflicts instead of letting a municipal claim silently override', () => {
    const base = {
      format: 'travel-reliability-country-pack/1',
      version: 'synthetic-v1',
      scope: { country: 'BR', subdivision: null, municipality: null },
      synthetic: true,
      evidence: [],
      mobility_apps: [],
      food_and_delivery_apps: [],
      payment_and_connectivity: [],
      safety_and_sanitary: [
        {
          id: 'C1',
          key: 'test.water',
          statement: 'Synthetic observation A',
          context: 'Synthetic household fixture',
          value: 'A',
          kind: 'fact',
          evidenceRefs: [],
          validFrom: '2026-11-01T00:00:00Z',
          validTo: '2026-11-30T00:00:00Z',
          personas: ['family'],
        },
      ],
    };
    const local = structuredClone(base);
    local.scope = {
      country: 'BR',
      subdivision: 'STATE-SYNTHETIC',
      municipality: 'CITY-SYNTHETIC',
    } as unknown as typeof local.scope;
    local.safety_and_sanitary[0]!.id = 'C2';
    local.safety_and_sanitary[0]!.statement = 'Synthetic observation B';
    local.safety_and_sanitary[0]!.value = 'B';
    const packet = {
      evaluatedAt: '2026-11-03T12:00:00Z',
      scope: local.scope,
      persona: 'family',
      packs: [base, local],
    };
    const result = countryContext(packet);
    expect(result.conflicts).toEqual(['test.water']);
    expect(result.claims.every((c) => c.status === 'conflicting')).toBe(true);
    expect(() =>
      countryContext({
        ...packet,
        scope: { country: 'BR', subdivision: null, municipality: 'CITY-SYNTHETIC' },
      }),
    ).toThrow('COUNTRY_HIERARCHY_REQUIRED');
    expect(() => countryContext({ ...packet, executePlugin: true })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
  });
  it('rejects restricted output without reflecting it in diagnostics', () => {
    const input = String.fromCharCode(98, 101, 101, 114);
    expect(() => enforceContentPolicy({ imported: input })).toThrow('RESTRICTED_CONTENT');
    expect(() =>
      enforceContentPolicy({ imported: 'Specialty coffee and local craftsmanship.' }),
    ).not.toThrow();
  });
});
