import defaultGraph from '../../data/loyalty_graph.json' with { type: 'json' };
import { loyaltyArbitrageSchema, loyaltyGraphSchema } from '../../schema/src/intelligence.js';
import {
  digest,
  evidenceStatus,
  receipt,
  safeInteger,
  validatePassive,
  type EvidenceReference,
} from '../../agent/provenance.js';
import { requireCondition } from './errors.js';
interface Ratio {
  sourceUnits: number;
  targetUnits: number;
}
export interface LoyaltyEdge {
  id: string;
  source_program: string;
  target_program: string;
  edge_type: string;
  verification_state: string;
  base_ratio: Ratio | null;
  club_tier_ratio: Ratio | null;
  min_transfer_points: number | null;
  max_transfer_points: number | null;
  transfer_multiple: number | null;
  max_target_units: number | null;
  eligibility_constraint: string[];
  settlement_business_days: number | null;
  transfer_bonus_bps: number;
  settlement_calendar: string | null;
  supports_cart_topup: boolean | null;
  last_verified_date: string | null;
  evidenceRefs: string[];
}
export interface LoyaltyGraph {
  format: string;
  version: string;
  synthetic: boolean;
  programs: string[];
  edges: LoyaltyEdge[];
  evidence: EvidenceReference[];
}
export interface LoyaltyInput {
  evaluatedAt: string;
  sourceProgram: string;
  targetProgram: string;
  sourcePoints: number;
  acquisitionCostPer1000Minor: number | null;
  topUp: { points: number; cashMinor: number } | null;
  eligibility: Array<{ code: string; value: 'yes' | 'no' | 'unknown' }>;
  requiredAwardPoints: number | null;
  awardTaxesMinor: number | null;
  cashFareMinor: number | null;
  currency: string;
  comparableBaggage: boolean | null;
  comparableCancellation: boolean | null;
  awardAvailable: boolean | null;
  pointsValidThroughTravel: boolean | null;
  maxHops: number;
  maxExpansions: number;
  maxResults: number;
}
const unique = (values: string[]) =>
  requireCondition(new Set(values).size === values.length, 'INTELLIGENCE_DUPLICATE_ID', 422);
const ceil = (n: bigint, d: bigint) => safeInteger((n + d - 1n) / d);
export function edgeAssertion(edge: LoyaltyEdge) {
  const { evidenceRefs: _refs, last_verified_date: _date, ...facts } = edge;
  return facts;
}
export function loyaltyArbitrage(supplied: unknown, suppliedGraph: unknown = defaultGraph) {
  validatePassive(loyaltyArbitrageSchema, supplied);
  validatePassive(loyaltyGraphSchema, suppliedGraph);
  const input = supplied as LoyaltyInput,
    graph = suppliedGraph as LoyaltyGraph;
  requireCondition(Number.isFinite(Date.parse(input.evaluatedAt)), 'INVALID_EVALUATION_TIME', 422);
  unique(graph.programs);
  unique(graph.edges.map((e) => e.id));
  unique(graph.evidence.map((e) => e.id));
  unique(input.eligibility.map((e) => e.code));
  requireCondition(
    input.sourceProgram !== input.targetProgram &&
      graph.programs.includes(input.sourceProgram) &&
      graph.programs.includes(input.targetProgram),
    'LOYALTY_PROGRAM_REJECTED',
    422,
  );
  for (const e of graph.edges) {
    requireCondition(
      graph.programs.includes(e.source_program) &&
        graph.programs.includes(e.target_program) &&
        e.source_program !== e.target_program,
      'LOYALTY_GRAPH_ENDPOINT_REJECTED',
      422,
    );
    requireCondition(
      e.min_transfer_points === null ||
        e.max_transfer_points === null ||
        e.min_transfer_points <= e.max_transfer_points,
      'LOYALTY_LIMIT_REJECTED',
      422,
    );
    requireCondition(
      e.transfer_multiple === null || e.transfer_multiple > 0,
      'LOYALTY_LIMIT_REJECTED',
      422,
    );
  }
  const initialPoints = BigInt(input.sourcePoints) + BigInt(input.topUp?.points ?? 0);
  requireCondition(initialPoints > 0n, 'ZERO_SOURCE_POINTS', 422);
  safeInteger(initialPoints);
  const costNumerator =
    input.acquisitionCostPer1000Minor === null && input.sourcePoints > 0
      ? null
      : BigInt(input.sourcePoints) * BigInt(input.acquisitionCostPer1000Minor ?? 0) +
        BigInt(input.topUp?.cashMinor ?? 0) * 1000n;
  type State = {
    program: string;
    points: bigint;
    programs: string[];
    edges: string[];
    gaps: string[];
    sources: string[];
    hops: Array<{ edgeId: string; inputPoints: number; outputPoints: number }>;
  };
  const queue: State[] = [
    {
      program: input.sourceProgram,
      points: initialPoints,
      programs: [input.sourceProgram],
      edges: [],
      gaps: [],
      sources: [],
      hops: [],
    },
  ];
  const rejected: Array<{ edgeId: string; code: string }> = [];
  const routes: Array<Record<string, unknown>> = [];
  let expansions = 0;
  while (queue.length && expansions < input.maxExpansions) {
    const current = queue.shift()!;
    if (current.edges.length >= input.maxHops) continue;
    for (const edge of graph.edges.filter((e) => e.source_program === current.program)) {
      if (expansions >= input.maxExpansions) {
        queue.push(current);
        break;
      }
      expansions++;
      if (current.programs.includes(edge.target_program)) continue;
      const deny = (code: string) => rejected.push({ edgeId: edge.id, code });
      if (!['DIRECT_TRANSFER', 'AVIOS_POOL_LINK'].includes(edge.edge_type)) {
        deny('EDGE_TYPE_NOT_POINT_TRANSFER');
        continue;
      }
      if (!edge.base_ratio) {
        deny('EDGE_RATIO_UNKNOWN');
        continue;
      }
      const no = edge.eligibility_constraint.some(
        (code) => input.eligibility.find((f) => f.code === code)?.value === 'no',
      );
      const missing = edge.eligibility_constraint.filter(
        (code) => input.eligibility.find((f) => f.code === code)?.value !== 'yes',
      );
      if (no || missing.length) {
        deny(no ? 'EDGE_INELIGIBLE' : 'EDGE_ELIGIBILITY_UNKNOWN');
        continue;
      }
      if (edge.min_transfer_points !== null && current.points < BigInt(edge.min_transfer_points)) {
        deny('BELOW_MINIMUM');
        continue;
      }
      if (edge.max_transfer_points !== null && current.points > BigInt(edge.max_transfer_points)) {
        deny('ABOVE_MAXIMUM');
        continue;
      }
      if (
        edge.transfer_multiple !== null &&
        current.points % BigInt(edge.transfer_multiple) !== 0n
      ) {
        deny('TRANSFER_LOT_REJECTED');
        continue;
      }
      const points =
        (current.points *
          BigInt(edge.base_ratio.targetUnits) *
          BigInt(10000 + edge.transfer_bonus_bps)) /
        (BigInt(edge.base_ratio.sourceUnits) * 10000n);
      if (points === 0n) {
        deny('ZERO_NET_POINTS');
        continue;
      }
      safeInteger(points);
      if (edge.max_target_units !== null && points > BigInt(edge.max_target_units)) {
        deny('TARGET_LIMIT_EXCEEDED');
        continue;
      }
      const supported =
        !graph.synthetic &&
        edge.evidenceRefs.length > 0 &&
        edge.evidenceRefs.every((id) => {
          const evidence = graph.evidence.find((record) => record.id === id);
          return (
            evidenceStatus(evidence, input.evaluatedAt) === 'supported' &&
            evidence!.assertion.subject === edge.id &&
            evidence!.assertion.predicate === 'loyalty.edge' &&
            digest(evidence!.assertion.value) === digest(edgeAssertion(edge))
          );
        });
      const gaps = [
        ...current.gaps,
        'ELIGIBILITY_OPERATOR_ATTESTED',
        'FEES_AND_ANNUAL_LIMIT_REVIEW_REQUIRED',
      ];
      if (!supported) gaps.push('EDGE_PROVENANCE_UNVERIFIED');
      if (
        edge.min_transfer_points === null ||
        edge.max_transfer_points === null ||
        edge.transfer_multiple === null
      )
        gaps.push('LIMIT_SCOPE_INCOMPLETE');
      if (edge.settlement_business_days === null || edge.settlement_calendar === null)
        gaps.push('SETTLEMENT_DEADLINE_UNCONFIRMED');
      if (input.topUp && current.edges.length === 0 && edge.supports_cart_topup !== true)
        gaps.push('CHECKOUT_TOPUP_NOT_CONFIRMED');
      const next: State = {
        program: edge.target_program,
        points,
        programs: [...current.programs, edge.target_program],
        edges: [...current.edges, edge.id],
        gaps,
        sources: [...current.sources, ...edge.evidenceRefs],
        hops: [
          ...current.hops,
          {
            edgeId: edge.id,
            inputPoints: safeInteger(current.points),
            outputPoints: safeInteger(points),
          },
        ],
      };
      if (next.program !== input.targetProgram) {
        queue.push(next);
        continue;
      }
      const enough =
        input.requiredAwardPoints !== null && points >= BigInt(input.requiredAwardPoints);
      const awardNumerator =
        costNumerator !== null && enough && input.awardTaxesMinor !== null
          ? costNumerator * BigInt(input.requiredAwardPoints!) +
            BigInt(input.awardTaxesMinor) * 1000n * points
          : null;
      const awardCost = awardNumerator === null ? null : ceil(awardNumerator, 1000n * points);
      const comparisonReady =
        awardCost !== null &&
        input.cashFareMinor !== null &&
        input.comparableBaggage === true &&
        input.comparableCancellation === true &&
        input.awardAvailable === true &&
        input.pointsValidThroughTravel === true;
      routes.push({
        path: next.programs,
        edgeIds: next.edges,
        hops: next.hops,
        netPointsReceived: safeInteger(points),
        sourceRefs: [...new Set(next.sources)],
        declaredAcquisitionCostMinor: costNumerator === null ? null : ceil(costNumerator, 1000n),
        effectiveCpmMinorPer1000: costNumerator === null ? null : ceil(costNumerator, points),
        awardTotalEconomicCostMinor: awardCost,
        declaredSavingsMinor: comparisonReady ? input.cashFareMinor! - awardCost! : null,
        verdict: comparisonReady
          ? 'conditional_documentary_comparison'
          : 'insufficient_comparable_evidence',
        displayMarker: '[UNVERIFIED_HYPOTHESIS — HUMAN CHECK REQUIRED]',
        status: 'needs_review',
        gaps: [
          ...new Set([
            ...next.gaps,
            ...(!enough ? ['AWARD_BALANCE_OR_REQUIREMENT_UNCONFIRMED'] : []),
          ]),
        ],
      });
    }
  }
  const allRejected = [...new Map(rejected.map((r) => [r.edgeId + ':' + r.code, r])).values()];
  routes.sort((a, b) => {
    const left = a.awardTotalEconomicCostMinor ?? a.effectiveCpmMinorPer1000;
    const right = b.awardTotalEconomicCostMinor ?? b.effectiveCpmMinorPer1000;
    if (left === null && right !== null) return 1;
    if (right === null && left !== null) return -1;
    return (
      Number(left ?? 0) - Number(right ?? 0) ||
      (a.edgeIds as string[]).length - (b.edgeIds as string[]).length ||
      JSON.stringify(a.path).localeCompare(JSON.stringify(b.path), 'en')
    );
  });
  const selected = routes.slice(0, input.maxResults);
  const usedRefs = new Set(selected.flatMap((route) => route.sourceRefs as string[]));
  const result = {
    graphVersion: graph.version,
    synthetic: graph.synthetic,
    routes: selected,
    sourceCatalog: graph.evidence
      .filter((record) => usedRefs.has(record.id))
      .map((record) => ({
        id: record.id,
        sourceUrl: record.sourceUrl,
        sourceSha256: record.sourceSha256,
        retrievedAt: record.retrievedAt,
        reviewAfter: record.reviewAfter,
        state: record.state,
        sourceSpan: record.sourceSpan,
      })),
    rejectedEdges: allRejected.slice(0, 40),
    rejectedEdgeCount: allRejected.length,
    rejectedTruncated: allRejected.length > 40,
    expansions,
    truncated: queue.length > 0 || routes.length > input.maxResults,
    ownedSourcePoints: input.sourcePoints,
    purchasedSourcePoints: input.topUp?.points ?? 0,
    transferredSourcePoints: safeInteger(initialPoints),
    currency: input.currency,
    scope:
      'Fixed input amount; simple paths only; no split balance optimization, user-injected promotional bonus, transfer, booking or payment. Combined conversion and configured bonus floor at each hop. Economic amounts cover declared acquisition, declared cart top-up and award taxes only. Unknown fees, limits, calendars and personal eligibility require review.',
    externalCalls: 0,
    factsVerified: false,
  };
  return {
    ...result,
    calculationReceipt: receipt('loyalty-arbitrage', input, result, input.evaluatedAt, graph),
  };
}
