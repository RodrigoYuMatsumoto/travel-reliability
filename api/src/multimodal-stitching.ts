import { multimodalStitchingSchema } from '../../schema/src/intelligence.js';
import { receipt, safeInteger, validatePassive } from '../../agent/provenance.js';
import { instant } from './validation.js';
import { requireCondition } from './errors.js';
interface LocalTime {
  local: string;
  timeZone: string;
}
export interface MultimodalLeg {
  id: string;
  origin: string;
  destination: string;
  mode: 'flight' | 'bus' | 'rail' | 'transfer' | 'ferry';
  departure: LocalTime;
  arrival: LocalTime;
  currency: string;
  costMinor: number | null;
  bookingGroup: string | null;
  baggageThrough: boolean | null;
  positioning: boolean;
  hiddenCity: boolean;
  sourceRefs: string[];
}
export interface MultimodalInput {
  evaluatedAt: string;
  origin: string;
  destination: string;
  nodes: Array<{
    id: string;
    minimumConnectionMinutes: number | null;
    timeZone: string | null;
    country: string | null;
  }>;
  legs: MultimodalLeg[];
  sources: Array<{ id: string; observedAt: string; evidenceRef: string | null }>;
  separateTicketBufferMinutes: number | null;
  baggageBufferMinutes: number | null;
  maxHops: number;
  maxExpansions: number;
  maxResults: number;
}
export function multimodalStitching(supplied: unknown) {
  validatePassive(multimodalStitchingSchema, supplied);
  const input = supplied as MultimodalInput;
  requireCondition(
    Number.isFinite(Date.parse(input.evaluatedAt)) &&
      input.sources.every((source) => Number.isFinite(Date.parse(source.observedAt))),
    'INVALID_EVALUATION_TIME',
    422,
  );
  for (const values of [input.nodes, input.legs, input.sources])
    requireCondition(
      new Set(values.map((v) => v.id)).size === values.length,
      'INTELLIGENCE_DUPLICATE_ID',
      422,
    );
  const nodes = new Map(input.nodes.map((n) => [n.id, n]));
  requireCondition(
    nodes.has(input.origin) && nodes.has(input.destination) && input.origin !== input.destination,
    'ROUTE_ENDPOINT_REJECTED',
    422,
  );
  const times = new Map<string, { departure: number; arrival: number }>();
  for (const leg of input.legs) {
    requireCondition(
      nodes.has(leg.origin) && nodes.has(leg.destination) && leg.origin !== leg.destination,
      'ROUTE_ENDPOINT_REJECTED',
      422,
    );
    requireCondition(
      (nodes.get(leg.origin)!.timeZone === null ||
        nodes.get(leg.origin)!.timeZone === leg.departure.timeZone) &&
        (nodes.get(leg.destination)!.timeZone === null ||
          nodes.get(leg.destination)!.timeZone === leg.arrival.timeZone),
      'NODE_TIME_ZONE_MISMATCH',
      422,
    );
    let departure: number | null = null,
      arrival: number | null = null;
    try {
      departure = instant(leg.departure);
      arrival = instant(leg.arrival);
    } catch {
      /* Reject ambiguous or nonexistent local time. */
    }
    requireCondition(
      departure !== null && arrival !== null && departure < arrival,
      'ROUTE_TIME_REJECTED',
      422,
    );
    requireCondition(
      leg.sourceRefs.length > 0 &&
        leg.sourceRefs.every((id) => input.sources.some((s) => s.id === id)),
      'ROUTE_SOURCE_REQUIRED',
      422,
    );
    requireCondition(
      leg.sourceRefs.every(
        (id) =>
          Date.parse(input.sources.find((s) => s.id === id)!.observedAt) <=
          Date.parse(input.evaluatedAt),
      ),
      'ROUTE_FUTURE_SOURCE',
      422,
    );
    times.set(leg.id, { departure, arrival });
  }
  type State = {
    node: string;
    legs: MultimodalLeg[];
    arrival: number | null;
    visited: string[];
    gaps: string[];
    connections: Array<{
      node: string;
      waitMinutes: number;
      requiredMinutes: number | null;
      protection: string;
    }>;
  };
  const queue: State[] = [
    {
      node: input.origin,
      legs: [],
      arrival: null,
      visited: [input.origin],
      gaps: [],
      connections: [],
    },
  ];
  const candidates: Array<Record<string, unknown>> = [];
  const rejected: Array<{ legId: string; code: string }> = [];
  let expansions = 0;
  while (queue.length && expansions < input.maxExpansions) {
    const current = queue.shift()!;
    if (current.legs.length >= input.maxHops) continue;
    for (const leg of input.legs.filter((l) => l.origin === current.node)) {
      if (expansions >= input.maxExpansions) {
        queue.push(current);
        break;
      }
      expansions++;
      if (current.visited.includes(leg.destination)) continue;
      const clock = times.get(leg.id)!;
      if (clock.departure < Date.parse(input.evaluatedAt)) {
        rejected.push({ legId: leg.id, code: 'DEPARTURE_IN_PAST' });
        continue;
      }
      const gaps = [...current.gaps, 'SCHEDULE_AVAILABILITY_AND_SOURCE_AUTHENTICITY_UNCONFIRMED'];
      if (nodes.get(leg.origin)!.timeZone === null || nodes.get(leg.destination)!.timeZone === null)
        gaps.push('NODE_TIME_ZONE_UNCONFIRMED');
      if (
        nodes.get(leg.origin)!.country !== nodes.get(leg.destination)!.country ||
        nodes.get(leg.origin)!.country === null
      )
        gaps.push('JURISDICTION_ENTRY_REQUIREMENTS_UNCONFIRMED');
      const connections = [...current.connections];
      const prior = current.legs.at(-1);
      if (prior) {
        const waitMinutes = (clock.departure - current.arrival!) / 60000;
        const separate =
          prior.bookingGroup === null ||
          leg.bookingGroup === null ||
          prior.bookingGroup !== leg.bookingGroup;
        const minimum = nodes.get(current.node)!.minimumConnectionMinutes;
        const baggage = prior.baggageThrough === true ? 0 : input.baggageBufferMinutes;
        const separateBuffer = separate ? input.separateTicketBufferMinutes : 0;
        const known = minimum !== null && baggage !== null && separateBuffer !== null;
        const requiredMinutes = known
          ? safeInteger(BigInt(minimum) + BigInt(baggage) + BigInt(separateBuffer))
          : null;
        if (waitMinutes < 0 || (requiredMinutes !== null && waitMinutes < requiredMinutes)) {
          rejected.push({ legId: leg.id, code: 'CONNECTION_BUFFER_NOT_MET' });
          continue;
        }
        if (requiredMinutes === null) gaps.push('CONNECTION_BUFFER_UNKNOWN');
        if (separate) gaps.push('SEPARATE_TICKET_SELF_TRANSFER');
        else gaps.push('CONTRACTUAL_CONNECTION_PROTECTION_UNCONFIRMED');
        connections.push({
          node: current.node,
          waitMinutes,
          requiredMinutes,
          protection: separate ? 'self_transfer' : 'not_verified_by_booking_group',
        });
      }
      if (leg.hiddenCity) gaps.push('HIDDEN_CITY_CONTRACT_AND_BAGGAGE_REVIEW');
      if (leg.positioning) gaps.push('POSITIONING_SERVICE_AND_RECOVERY_REVIEW');
      if (leg.costMinor === null) gaps.push('COST_UNKNOWN');
      const next: State = {
        node: leg.destination,
        legs: [...current.legs, leg],
        arrival: clock.arrival,
        visited: [...current.visited, leg.destination],
        gaps,
        connections,
      };
      if (next.node !== input.destination) {
        queue.push(next);
        continue;
      }
      const totals: Record<string, number> = {};
      for (const segment of next.legs)
        if (segment.costMinor !== null)
          totals[segment.currency] = safeInteger(
            BigInt(totals[segment.currency] ?? 0) + BigInt(segment.costMinor),
          );
      const currencies = Object.keys(totals);
      const totalComplete = !next.legs.some((l) => l.costMinor === null) && currencies.length === 1;
      candidates.push({
        legIds: next.legs.map((l) => l.id),
        modes: next.legs.map((l) => l.mode),
        nodeIds: next.visited,
        departure: next.legs[0]!.departure,
        arrival: leg.arrival,
        durationMinutes: (clock.arrival - times.get(next.legs[0]!.id)!.departure) / 60000,
        connections,
        knownTotals: totals,
        completeTotalMinor: totalComplete ? totals[currencies[0]!] : null,
        status: 'conditional',
        displayMarker: '[UNVERIFIED_HYPOTHESIS — HUMAN CHECK REQUIRED]',
        sourceRefs: [...new Set(next.legs.flatMap((l) => l.sourceRefs))],
        gaps: [...new Set(gaps)],
      });
    }
  }
  candidates.sort((a, b) => Number(a.durationMinutes) - Number(b.durationMinutes));
  const uniqueRejected = [
    ...new Map(rejected.map((row) => [row.legId + ':' + row.code, row])).values(),
  ];
  const result = {
    candidates: candidates.slice(0, input.maxResults),
    expansions,
    truncated: queue.length > 0 || candidates.length > input.maxResults,
    rejected: uniqueRejected.slice(0, 40),
    rejectedCount: uniqueRejected.length,
    rejectedTruncated: uniqueRejected.length > 40,
    scope:
      'Declared schedules and fixed supplied nodes only. Different terminals require explicit transfer legs. Unknown customs, entry, accessibility, infant and assistance requirements require review. No routing-provider lookup, reservation protection, universal minimum-connection-time or live availability is certified.',
    externalCalls: 0,
    factsVerified: false,
  };
  return {
    ...result,
    calculationReceipt: receipt('multimodal-stitching', input, result, input.evaluatedAt),
  };
}
