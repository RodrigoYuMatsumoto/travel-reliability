import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Temporal } from '@js-temporal/polyfill';
import {
  planningSchemas,
  type ToolId,
  type Offer,
  type ComparisonInput,
  type PromotionInput,
  type FareScenarioInput,
  type NegotiationInput,
  type HiddenCityInput,
  type GroupInput,
} from '../../schema/src/planning.js';
import { AppError, requireCondition } from './errors.js';

const ajv = new Ajv2020({ strict: true, allErrors: true });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validators = Object.fromEntries(
  Object.entries(planningSchemas).map(([id, schema]) => [id, ajv.compile(schema)]),
);
const exact = (value: bigint) => {
  const result = Number(value);
  requireCondition(Number.isSafeInteger(result), 'MONEY_OVERFLOW', 422);
  return result;
};
const sum = (items: number[]) => exact(items.reduce((total, item) => total + BigInt(item), 0n));
const unique = (ids: string[], code: string) =>
  requireCondition(new Set(ids).size === ids.length, code, 422);
const nightsOf = (o: Offer) =>
  o.destinationDepartureDate
    ? Temporal.PlainDate.from(o.destinationArrivalDate).until(
        Temporal.PlainDate.from(o.destinationDepartureDate),
      ).days
    : null;
const coreScope = (o: Offer) =>
  JSON.stringify([
    o.origin,
    o.destination,
    o.returnDeparture !== null,
    nightsOf(o),
    o.passengers,
    o.cabin,
    o.baggage,
    o.requiredServices,
    o.paymentCategory,
  ]);
const fullScope = (o: Offer) =>
  JSON.stringify([
    coreScope(o),
    o.departure,
    o.returnDeparture,
    o.destinationArrivalDate,
    o.destinationDepartureDate,
  ]);
export function costOf(offer: Offer) {
  unique(
    offer.costs.map((c) => c.id),
    'DUPLICATE_COST',
  );
  unique(
    offer.sources.map((s) => s.id),
    'DUPLICATE_SOURCE',
  );
  const sourceIds = new Set(offer.sources.map((s) => s.id));
  const totals: Record<string, number> = {},
    unknown: string[] = [];
  const items = offer.costs.map((c) => {
    requireCondition(
      c.sourceIds.every((id) => sourceIds.has(id)),
      'COST_SOURCE_NOT_FOUND',
      422,
    );
    const counted = c.treatment === 'necessary' || (c.selected && c.treatment !== 'included');
    const evidenced = c.sourceIds.length > 0;
    if (c.treatment === 'included' && !evidenced) unknown.push(c.id);
    const amountMinor =
      counted && c.unitMinor !== null && evidenced
        ? exact(BigInt(c.unitMinor) * BigInt(c.quantity))
        : null;
    if (counted && amountMinor === null) unknown.push(c.id);
    if (amountMinor !== null) totals[c.currency] = sum([totals[c.currency] ?? 0, amountMinor]);
    return {
      ...c,
      counted,
      amountMinor,
      formula: counted ? `${c.unitMinor ?? 'unknown'} × ${c.quantity}` : 'not added',
    };
  });
  return {
    items,
    knownTotals: totals,
    unknownCostIds: unknown,
    complete: unknown.length === 0,
    finalTotals: unknown.length ? null : totals,
  };
}
function difference(
  base: Offer | undefined,
  candidate: Offer,
  evaluatedAt: string,
  datesMustMatch = true,
) {
  if (
    !base ||
    (datesMustMatch
      ? fullScope(base) !== fullScope(candidate)
      : coreScope(base) !== coreScope(candidate))
  )
    return { savingsMinor: null, reason: 'NO_EQUIVALENT_BASELINE' };
  const a = costOf(base),
    b = costOf(candidate),
    currencies = Object.keys(a.knownTotals);
  if (base.returnDeparture && (nightsOf(base) === null || nightsOf(candidate) === null))
    return { savingsMinor: null, reason: 'DESTINATION_NIGHTS_UNKNOWN' };
  const current =
    base.sources.every((s) => s.status === 'observed') &&
    candidate.sources.every((s) => s.status === 'observed');
  const times = [...base.sources, ...candidate.sources].map((s) => Date.parse(s.observedAt));
  const evaluated = Date.parse(evaluatedAt);
  if (
    !base.validUntil ||
    !candidate.validUntil ||
    Date.parse(base.validUntil) <= evaluated ||
    Date.parse(candidate.validUntil) <= evaluated ||
    times.some((time) => time > evaluated || evaluated - time > 3600000)
  )
    return { savingsMinor: null, reason: 'OFFER_VALIDITY_OR_FRESHNESS_UNCONFIRMED' };
  if (
    !a.complete ||
    !b.complete ||
    currencies.length !== 1 ||
    Object.keys(b.knownTotals).join() !== currencies.join() ||
    !current ||
    Math.max(...times) - Math.min(...times) > 3600000 ||
    !base.capacityConfirmed ||
    !candidate.capacityConfirmed
  )
    return { savingsMinor: null, reason: 'INCOMPLETE_OR_NONCONTEMPORARY_EVIDENCE' };
  const currency = currencies[0]!;
  return {
    savingsMinor: a.knownTotals[currency]! - b.knownTotals[currency]!,
    currency,
    reason: null,
  };
}
function evaluateOffers(input: ComparisonInput, tool: ToolId) {
  unique(
    input.offers.map((o) => o.id),
    'DUPLICATE_OFFER',
  );
  if (input.baselineId)
    requireCondition(
      input.offers.some((o) => o.id === input.baselineId),
      'BASELINE_NOT_FOUND',
      422,
    );
  if (tool === 'flex-dates')
    requireCondition(input.departureDate !== null, 'DEPARTURE_DATE_REQUIRED', 422);
  if (tool === 'airports')
    requireCondition(
      input.allowedAirports.length > 0 ||
        input.maxGroundKm !== null ||
        input.maxGroundMinutes !== null,
      'AIRPORT_SCOPE_REQUIRED',
      422,
    );
  const base = input.offers.find((o) => o.id === input.baselineId);
  const rows = input.offers.map((offer) => {
    const failures: string[] = [],
      pending: string[] = [],
      cost = costOf(offer);
    const durationMinutes = (Date.parse(offer.arrival) - Date.parse(offer.departure)) / 60000;
    requireCondition(
      durationMinutes >= 0 && Number.isInteger(durationMinutes),
      'INVALID_OFFER_CHRONOLOGY',
      422,
    );
    const nights = offer.destinationDepartureDate
      ? Temporal.PlainDate.from(offer.destinationArrivalDate).until(
          Temporal.PlainDate.from(offer.destinationDepartureDate),
        ).days
      : null;
    requireCondition(nights === null || nights >= 0, 'INVALID_STAY', 422);
    if (offer.validUntil && Date.parse(offer.validUntil) <= Date.parse(input.evaluatedAt))
      failures.push('OFFER_EXPIRED');
    if (!offer.validUntil) pending.push('OFFER_VALIDITY_UNKNOWN');
    if (offer.capacityConfirmed !== true) pending.push('GROUP_CAPACITY_UNCONFIRMED');
    if (offer.sources.some((s) => s.status !== 'observed'))
      pending.push('DOCUMENTARY_OR_INDICATIVE_PRICE');
    if (offer.sources.some((s) => Date.parse(s.observedAt) > Date.parse(input.evaluatedAt)))
      pending.push('SOURCE_TIMESTAMP_IN_FUTURE');
    if (!cost.complete) pending.push('REQUIRED_COST_UNKNOWN');
    if (input.stayNights !== null && nights !== input.stayNights)
      (nights === null ? pending : failures).push('STAY_NOT_EQUIVALENT');
    if (tool === 'flex-dates') {
      const delta = (date: string, reference: string) =>
        Math.abs(Temporal.PlainDate.from(reference).until(Temporal.PlainDate.from(date)).days);
      if (
        delta(offer.departure.slice(0, 10), input.departureDate!) > input.flexDays ||
        (input.returnDate &&
          (!offer.returnDeparture ||
            delta(offer.returnDeparture.slice(0, 10), input.returnDate) > input.flexDays))
      )
        failures.push('OUTSIDE_DATE_WINDOW');
      if (input.returnDate && nights === null) pending.push('DESTINATION_NIGHTS_UNKNOWN');
      if (
        base &&
        base.destinationDepartureDate &&
        nights !==
          Temporal.PlainDate.from(base.destinationArrivalDate).until(
            Temporal.PlainDate.from(base.destinationDepartureDate),
          ).days
      )
        failures.push('BASELINE_STAY_REDUCED_OR_CHANGED');
    }
    if (tool === 'airports') {
      if (input.allowedAirports.length && !input.allowedAirports.includes(offer.airport))
        failures.push('AIRPORT_OUTSIDE_SCOPE');
      for (const [limit, actual, code] of [
        [input.maxGroundKm, offer.groundDistanceKm, 'GROUND_DISTANCE'],
        [input.maxGroundMinutes, offer.groundMinutes, 'GROUND_DURATION'],
      ] as const)
        if (limit !== null) {
          if (actual === null) pending.push(code + '_UNKNOWN');
          else if (actual > limit) failures.push(code + '_EXCEEDED');
        }
    }
    if (tool === 'connections' || tool === 'airports') {
      if (offer.overnight && !input.overnightAllowed) failures.push('OVERNIGHT_NOT_ALLOWED');
      if (offer.ticketStructure === 'separate' && !input.separateTicketsAllowed)
        failures.push('SEPARATE_TICKETS_NOT_ALLOWED');
      if (offer.ticketStructure === 'unknown') pending.push('TICKET_STRUCTURE_UNKNOWN');
      if (!offer.connectionProtectionSourceId && offer.connections.length)
        pending.push('CONNECTION_PROTECTION_UNCONFIRMED');
      if (offer.connectionProtectionSourceId)
        requireCondition(
          offer.sources.some((s) => s.id === offer.connectionProtectionSourceId),
          'PROTECTION_SOURCE_NOT_FOUND',
          422,
        );
      if (input.maxConnections !== null && offer.connections.length > input.maxConnections)
        failures.push('CONNECTION_LIMIT');
      if (input.maxDurationMinutes !== null && durationMinutes > input.maxDurationMinutes)
        failures.push('DURATION_LIMIT');
      for (const c of offer.connections) {
        if (c.airportChange && !input.airportChangeAllowed)
          failures.push('AIRPORT_CHANGE_NOT_ALLOWED');
        if (
          c.minimumMinutes === null ||
          !c.sourceId ||
          !c.basis ||
          c.baggageRecheck === null ||
          c.entryPermission === 'unknown'
        )
          pending.push('CONNECTION_FACTS_MISSING');
        if (c.sourceId)
          requireCondition(
            offer.sources.some((s) => s.id === c.sourceId),
            'CONNECTION_SOURCE_NOT_FOUND',
            422,
          );
        const available = (Date.parse(c.departure) - Date.parse(c.arrival)) / 60000;
        if (available < 0 || (c.minimumMinutes !== null && available < c.minimumMinutes))
          failures.push('CONNECTION_BUFFER_INSUFFICIENT');
      }
    }
    if (input.budgetMinor !== null) {
      if ((cost.knownTotals[input.budgetCurrency ?? ''] ?? 0) > input.budgetMinor)
        failures.push('KNOWN_SUBTOTAL_EXCEEDS_BUDGET');
      if (
        !cost.complete ||
        Object.keys(cost.knownTotals).length !== 1 ||
        cost.knownTotals[input.budgetCurrency ?? ''] === undefined
      )
        pending.push('BUDGET_NOT_DETERMINABLE');
      else if (cost.knownTotals[input.budgetCurrency!]! > input.budgetMinor)
        failures.push('BUDGET_EXCEEDED');
    }
    return {
      id: offer.id,
      seller: offer.seller,
      operator: offer.operator,
      nights,
      durationMinutes,
      cost,
      difference: failures.length
        ? { savingsMinor: null, reason: 'INELIGIBLE_OFFER' }
        : difference(base, offer, input.evaluatedAt, tool !== 'flex-dates'),
      status: failures.length ? 'ineligible' : pending.length ? 'conditional' : 'documented',
      failures: [...new Set(failures)],
      pending: [...new Set(pending)],
      sources: offer.sources,
    };
  });
  return {
    rows,
    ranking: null,
    rankingReason:
      'Compare only equivalent scope, complete totals and contemporary evidence. No universal winner.',
    fastestId:
      [...rows]
        .filter((r) => r.status !== 'ineligible')
        .sort((a, b) => a.durationMinutes - b.durationMinutes)[0]?.id ?? null,
  };
}
function promotions(input: PromotionInput) {
  const rows = evaluateOffers(input.comparison, 'total-cost').rows;
  unique(
    input.promotions.map((p) => p.id),
    'DUPLICATE_PROMOTION',
  );
  return input.promotions.map((p) => {
    const offer = input.comparison.offers.find((o) => o.id === p.offerId),
      base = input.comparison.offers.find((o) => o.id === p.baselineId);
    requireCondition(offer && base, 'PROMOTION_OFFER_NOT_FOUND', 422);
    requireCondition(offer.id !== base.id, 'PROMOTION_BASELINE_IDENTICAL', 422);
    requireCondition(
      Date.parse(p.purchaseFrom) < Date.parse(p.purchaseUntil),
      'INVALID_PROMOTION_WINDOW',
      422,
    );
    const valid =
      Date.parse(p.purchaseFrom) <= Date.parse(input.comparison.evaluatedAt) &&
      Date.parse(input.comparison.evaluatedAt) < Date.parse(p.purchaseUntil);
    const quote = rows.find((r) => r.id === p.offerId)!,
      baseline = rows.find((r) => r.id === p.baselineId)!;
    const eligible =
      valid &&
      p.eligibility === 'confirmed' &&
      p.application === 'observed' &&
      quote.status === 'documented' &&
      baseline.status === 'documented' &&
      p.source.status === 'observed' &&
      Date.parse(p.source.observedAt) <= Date.parse(input.comparison.evaluatedAt) &&
      Date.parse(input.comparison.evaluatedAt) - Date.parse(p.source.observedAt) <= 3600000;
    const delta = eligible
      ? difference(base, offer, input.comparison.evaluatedAt)
      : { savingsMinor: null, reason: 'ELIGIBILITY_OR_APPLICATION_UNCONFIRMED' };
    return {
      ...p,
      status:
        !valid ||
        p.eligibility === 'ineligible' ||
        quote.status === 'ineligible' ||
        baseline.status === 'ineligible'
          ? 'ineligible'
          : eligible && delta.savingsMinor !== null
            ? 'documented'
            : 'conditional',
      difference: delta,
    };
  });
}
function scenarios(input: FareScenarioInput) {
  return input.options.map((o) => {
    const entries = [
      o.changeFeeMinor,
      o.issuerFeeMinor,
      o.fareDifferenceMinor,
      o.taxDifferenceMinor,
      o.reboughtServicesMinor,
    ];
    const changeSubtotalMinor = sum(entries.filter((v): v is number => v !== null));
    const unknown = entries.some((v) => v === null);
    return {
      ...o,
      changeKnownSubtotalMinor: changeSubtotalMinor,
      changeAdditionalMinor: unknown ? null : changeSubtotalMinor,
      changeFormula:
        'change fee + issuer fee + fare difference + tax difference + rebought services',
      cashRefundMinor: o.refundCashMinor,
      creditIsCash: false,
      creditNeedsReview: o.creditMinor !== null && o.creditMinor > 0 && !o.creditConditions,
      caveats: [
        'Refund cash and recoverable taxes may overlap: never sum without explicit allocation.',
        'Retained value is supplied evidence, not an inferred penalty.',
        'Purchase-incorporated rules and supplier-initiated disruption need separate verification.',
      ],
    };
  });
}
function negotiation(input: NegotiationInput) {
  const pt = input.language === 'pt-BR';
  const comparison = input.comparison ? evaluateOffers(input.comparison, 'total-cost') : null;
  const constraints = input.constraints.length
    ? (pt ? ' Condições necessárias: ' : ' Required conditions: ') +
      input.constraints.join('; ') +
      '.'
    : '';
  const goal = input.goal.replace(/[\r\n]/g, ' '),
    recipient = input.recipient.replace(/[\r\n]/g, ' ');
  return {
    comparison,
    subject:
      input.channel === 'email'
        ? pt
          ? 'Consulta de condição comercial'
          : 'Commercial terms enquiry'
        : null,
    drafts: pt
      ? [
          `Olá, ${recipient}. Gostaria de consultar a possibilidade de ${goal}. Poderiam informar o valor final, com taxas e serviços necessários, as condições de elegibilidade, disponibilidade e validade?${constraints} Aguardo as condições para decidir. Obrigado.`,
          `Olá, ${recipient}. Antes de decidir, gostaria de verificar uma condição para ${goal}. Podem apresentar a melhor proposta disponível, discriminando preço final, inclusões, restrições e prazo?${constraints} A solicitação é uma consulta; a contratação dependerá da minha confirmação. Obrigado.`,
        ]
      : [
          `Hello, ${recipient}. Could you advise whether ${goal} is available? Please provide the final price, necessary services, taxes, eligibility, availability and validity.${constraints} I will review the terms before deciding. Thank you.`,
          `Hello, ${recipient}. Before deciding, I would like to enquire about ${goal}. Please share the available final proposal, inclusions, restrictions and deadline.${constraints} This is an enquiry; any purchase will require my confirmation. Thank you.`,
        ],
    pending: [
      'Recipient and request are user declarations.',
      'No competing-price, loyalty or urgency claim has been invented.',
      'Review facts and redact identifiers before manual sending.',
    ],
    sent: false,
  };
}
function hiddenCity(input: HiddenCityInput) {
  requireCondition(
    input.standard.destination === input.realDestination,
    'STANDARD_DESTINATION_MISMATCH',
    422,
  );
  requireCondition(
    input.contractedStops[0] === input.alternative.origin &&
      input.contractedStops.at(-1) === input.alternative.destination &&
      input.contractedStops.slice(1, -1).includes(input.realDestination),
    'HIDDEN_CITY_SEQUENCE_NOT_DOCUMENTED',
    422,
  );
  evaluateOffers(
    {
      offers: [input.standard, input.alternative],
      baselineId: null,
      evaluatedAt: input.evaluatedAt,
      departureDate: null,
      returnDate: null,
      flexDays: 0,
      stayNights: null,
      allowedAirports: [],
      maxGroundKm: null,
      maxGroundMinutes: null,
      budgetMinor: null,
      budgetCurrency: null,
      maxConnections: null,
      maxDurationMinutes: null,
      separateTicketsAllowed: false,
      airportChangeAllowed: false,
      overnightAllowed: false,
    },
    'total-cost',
  );
  unique(
    input.conditions.map((c) => c.topic),
    'DUPLICATE_RISK_TOPIC',
  );
  const standard = costOf(input.standard),
    alternative = costOf(input.alternative);
  const delta = difference(
    input.standard,
    { ...input.alternative, destination: input.realDestination },
    input.evaluatedAt,
  );
  const currencies = Object.keys(standard.knownTotals);
  const nominalDifferenceMinor = delta.savingsMinor;
  return {
    standard,
    alternative,
    nominalDifferenceMinor,
    currency: currencies.length === 1 ? currencies[0] : null,
    netSavingsGuaranteed: false,
    risks: [
      'baggage',
      'remaining_segments',
      'repricing',
      'loyalty',
      'operational_change',
      'entry',
    ].map((topic) => ({
      topic,
      condition: input.conditions.find((c) => c.topic === topic)?.condition ?? null,
      source: input.conditions.find((c) => c.topic === topic)?.source ?? null,
      status: input.conditions.find((c) => c.topic === topic)?.source
        ? 'documentary_needs_applicability_review'
        : 'unverified',
    })),
    alternativesToResearch: [
      'Contracted journey ending at the intended destination',
      'Authorized alternative airports or dates',
      'Permitted multi-city itinerary',
    ],
    limitations: [
      'No universal legal classification or sanction is asserted.',
      'No evasion, concealment, check-in or booking action is provided.',
    ],
  };
}
/** Largest remainder in integer minor units; stable household ID breaks ties. */
export function allocate(amount: number, shares: Array<{ householdId: string; weight: number }>) {
  requireCondition(
    Number.isSafeInteger(amount) &&
      amount >= 0 &&
      shares.length > 0 &&
      shares.every((s) => Number.isSafeInteger(s.weight) && s.weight > 0),
    'INVALID_ALLOCATION',
    422,
  );
  unique(
    shares.map((s) => s.householdId),
    'DUPLICATE_BENEFICIARY',
  );
  const totalWeight = shares.reduce((total, s) => total + BigInt(s.weight), 0n),
    value = BigInt(amount);
  const parts = shares.map((s) => ({
    id: s.householdId,
    amount: (value * BigInt(s.weight)) / totalWeight,
    remainder: (value * BigInt(s.weight)) % totalWeight,
  }));
  let remaining = value - parts.reduce((total, p) => total + p.amount, 0n);
  for (const p of [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.id.localeCompare(b.id) : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (remaining <= 0) break;
    p.amount++;
    remaining--;
  }
  return Object.fromEntries(parts.map((p) => [p.id, exact(p.amount)]));
}
function groupSplit(input: GroupInput) {
  unique(
    input.households.map((h) => h.id),
    'DUPLICATE_HOUSEHOLD',
  );
  unique(
    input.households.flatMap((h) => h.participants),
    'DUPLICATE_PARTICIPANT',
  );
  unique(
    input.scenarios.map((s) => s.id),
    'DUPLICATE_SCENARIO',
  );
  const ids = new Set(input.households.map((h) => h.id));
  return {
    currency: input.currency,
    participantCount: input.households.reduce((n, h) => n + h.participants.length, 0),
    scenarios: input.scenarios.map((s) => {
      unique(
        s.costs.map((c) => c.id),
        'DUPLICATE_COST',
      );
      unique(
        s.cashFlows.map((c) => c.id),
        'DUPLICATE_CASH_FLOW',
      );
      const low: Record<string, number> = Object.fromEntries([...ids].map((id) => [id, 0])),
        high = { ...low },
        boundLow = { ...low },
        boundHigh = { ...low },
        unknown = new Set<string>();
      let groupLow = 0,
        groupHigh = 0;
      const ledger = s.costs.map((c) => {
        unique(
          c.shares.map((p) => p.householdId),
          'DUPLICATE_BENEFICIARY',
        );
        requireCondition(
          c.shares.every((p) => ids.has(p.householdId)),
          'HOUSEHOLD_NOT_FOUND',
          422,
        );
        requireCondition(
          c.lowMinor === null || c.highMinor === null || c.lowMinor <= c.highMinor,
          'INVALID_COST_INTERVAL',
          422,
        );
        if (c.lowMinor === null || c.highMinor === null || !c.source || !c.acceptedRule) {
          c.shares.forEach((p) => unknown.add(p.householdId));
          return { ...c, allocations: null, status: 'conditional' };
        }
        const a = allocate(c.lowMinor, c.shares),
          b = allocate(c.highMinor, c.shares);
        const weight = c.shares.reduce((total, p) => total + BigInt(p.weight), 0n);
        for (const p of c.shares) {
          low[p.householdId] = sum([low[p.householdId]!, a[p.householdId]!]);
          high[p.householdId] = sum([high[p.householdId]!, b[p.householdId]!]);
          const lower =
            c.lowMinor === c.highMinor
              ? a[p.householdId]!
              : exact((BigInt(c.lowMinor) * BigInt(p.weight)) / weight);
          const upper =
            c.lowMinor === c.highMinor
              ? b[p.householdId]!
              : exact((BigInt(c.highMinor) * BigInt(p.weight) + weight - 1n) / weight);
          boundLow[p.householdId] = sum([boundLow[p.householdId]!, lower]);
          boundHigh[p.householdId] = sum([boundHigh[p.householdId]!, upper]);
        }
        groupLow = sum([groupLow, c.lowMinor]);
        groupHigh = sum([groupHigh, c.highMinor]);
        return {
          ...c,
          allocations: { low: a, high: b },
          status: c.lowMinor === c.highMinor ? 'documented' : 'estimated_interval',
        };
      });
      const households = input.households.map((h) => {
        const cash = new Map<number, { cash: number; hold: number }>();
        for (const f of s.cashFlows) {
          requireCondition(ids.has(f.householdId), 'HOUSEHOLD_NOT_FOUND', 422);
          if (f.householdId !== h.id) continue;
          const at = Date.parse(f.at),
            point = cash.get(at) ?? { cash: 0, hold: 0 };
          if (f.kind === 'card_hold' || f.kind === 'card_release')
            point.hold = sum([point.hold, (f.kind === 'card_hold' ? 1 : -1) * f.amountMinor]);
          else
            point.cash = sum([
              point.cash,
              (['payment', 'deposit'].includes(f.kind) ? 1 : -1) * f.amountMinor,
            ]);
          cash.set(at, point);
        }
        let balance = 0,
          hold = 0,
          peakCashMinor = 0,
          peakCardHoldMinor = 0;
        for (const [, p] of [...cash].sort(([a], [b]) => a - b)) {
          balance = sum([balance, p.cash]);
          hold = sum([hold, p.hold]);
          requireCondition(balance >= 0 && hold >= 0, 'CASH_RETURN_WITHOUT_EXPOSURE', 422);
          peakCashMinor = Math.max(peakCashMinor, balance);
          peakCardHoldMinor = Math.max(peakCardHoldMinor, hold);
        }
        const indeterminate = unknown.has(h.id) || h.ceilingMinor === null;
        const deficit = indeterminate
          ? null
          : {
              lowMinor: Math.max(0, boundLow[h.id]! - h.ceilingMinor!),
              highMinor: Math.max(0, boundHigh[h.id]! - h.ceilingMinor!),
            };
        return {
          id: h.id,
          ceilingMinor: h.ceilingMinor,
          knownCost: { lowMinor: boundLow[h.id], highMinor: boundHigh[h.id] },
          endpointAllocations: { lowEndpointMinor: low[h.id], highEndpointMinor: high[h.id] },
          finalCost: unknown.has(h.id)
            ? null
            : { lowMinor: boundLow[h.id], highMinor: boundHigh[h.id] },
          deficit,
          minimumDemonstratedDeficitMinor:
            h.ceilingMinor === null ? null : Math.max(0, boundLow[h.id]! - h.ceilingMinor),
          peakCashMinor: cash.size ? peakCashMinor : null,
          peakCardHoldMinor: cash.size ? peakCardHoldMinor : null,
          cashWithinLimit:
            cash.size && h.cashLimitMinor !== null ? peakCashMinor <= h.cashLimitMinor : null,
        };
      });
      requireCondition(
        sum(Object.values(low)) === groupLow && sum(Object.values(high)) === groupHigh,
        'ALLOCATION_RECONCILIATION_FAILED',
        500,
      );
      const expired =
        s.validUntil !== null && Date.parse(s.validUntil) <= Date.parse(input.evaluatedAt);
      const exceeds = households.some(
        (h) =>
          (h.minimumDemonstratedDeficitMinor !== null && h.minimumDemonstratedDeficitMinor > 0) ||
          h.cashWithinLimit === false,
      );
      const conditional =
        unknown.size > 0 ||
        s.constraintsConfirmed !== true ||
        s.capacityConfirmed !== true ||
        !s.validUntil ||
        s.costs.some((c) => c.lowMinor !== c.highMinor || c.source?.status !== 'observed') ||
        input.households.some((h) => h.cashLimitMinor !== null) ||
        households.some((h) => !h.deficit || h.deficit.highMinor > 0);
      return {
        id: s.id,
        destination: s.destination,
        model: s.model,
        scope: s.scope,
        nights: s.nights,
        ledger,
        households,
        groupKnownCost: { lowMinor: groupLow, highMinor: groupHigh },
        groupFinalCost: unknown.size ? null : { lowMinor: groupLow, highMinor: groupHigh },
        status:
          expired || exceeds || s.constraintsConfirmed === false || s.capacityConfirmed === false
            ? 'ineligible'
            : conditional
              ? 'conditional'
              : 'within_declared_ceilings',
        cashScheduleComplete: false,
        limitations: [
          'Cash exposure describes only supplied dated flows; it does not certify a complete payment schedule.',
          'Deposit and card holds are cash exposure, never added automatically to travel expense.',
          'Shares express the supplied accepted rule, not a determination of fairness.',
        ],
      };
    }),
  };
}
export function plan(tool: string, value: unknown) {
  requireCondition(Object.hasOwn(validators, tool), 'UNKNOWN_PLANNING_TOOL', 404);
  const check = validators[tool]!;
  if (!check(value))
    throw new AppError(
      'INVALID_PLANNING_INPUT',
      422,
      check.errors?.map((e) => ({ path: e.instancePath, keyword: e.keyword })),
    );
  const timeKeys = new Set([
    'observedAt',
    'departure',
    'arrival',
    'returnDeparture',
    'validUntil',
    'evaluatedAt',
    'purchaseFrom',
    'purchaseUntil',
    'scenarioAt',
    'at',
  ]);
  const validateTimes = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    for (const [key, item] of Object.entries(node)) {
      if (timeKeys.has(key) && typeof item === 'string')
        requireCondition(Number.isFinite(Date.parse(item)), 'INVALID_TIMESTAMP', 422);
      if (typeof item === 'object') validateTimes(item);
    }
  };
  validateTimes(value);
  let result: unknown;
  if (['flex-dates', 'airports', 'connections', 'total-cost'].includes(tool))
    result = evaluateOffers(value as ComparisonInput, tool as ToolId);
  else if (tool === 'promotions') result = promotions(value as PromotionInput);
  else if (tool === 'fare-scenarios') result = scenarios(value as FareScenarioInput);
  else if (tool === 'negotiation') result = negotiation(value as NegotiationInput);
  else if (tool === 'hidden-city') result = hiddenCity(value as HiddenCityInput);
  else result = groupSplit(value as GroupInput);
  return { tool, version: '1.0.0', mode: 'documentary', externalCalls: 0, result };
}
