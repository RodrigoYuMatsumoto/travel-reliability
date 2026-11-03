import { Temporal } from '@js-temporal/polyfill';
import { receipt, safeInteger, validatePassive } from '../../agent/provenance.js';
import {
  groundTransportSchema,
  groundCategories,
  mandatoryGroundCategories,
  type GroundTransportInput,
  type GroundOffer,
  type GroundSource,
} from '../../schema/src/ground-transport.js';
import { AppError, requireCondition } from './errors.js';

function instant(value: string): number {
  try {
    return Number(Temporal.Instant.from(value).epochMilliseconds);
  } catch {
    throw new AppError('GROUND_TIME_REJECTED', 422);
  }
}
function date(value: string) {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw new AppError('GROUND_DATE_REJECTED', 422);
  }
}
const normalized = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en');
const unique = (values: string[]) =>
  requireCondition(new Set(values).size === values.length, 'GROUND_DUPLICATE_ID', 422);
const ceil = (a: number, b: number) => safeInteger((BigInt(a) + BigInt(b) - 1n) / BigInt(b));

/** No source lookup, provider confirmation, model inference or purchase occurs here. */
export function groundTransport(supplied: unknown) {
  validatePassive(groundTransportSchema, supplied);
  const input = supplied as GroundTransportInput,
    profile = input.travelerProfile,
    window = input.requestedWindow;
  requireCondition(
    normalized(window.origin).length > 0 &&
      (window.destination === null || normalized(window.destination).length > 0),
    'GROUND_LOCATION_REJECTED',
    422,
  );
  const now = instant(input.evaluatedAt),
    from = instant(window.earliestDepartureAt),
    until = instant(window.latestReturnAt);
  requireCondition(from < until, 'GROUND_WINDOW_REJECTED', 422);
  try {
    Temporal.Instant.from(window.earliestDepartureAt).toZonedDateTimeISO(window.timeZone);
  } catch {
    requireCondition(false, 'GROUND_TIME_ZONE_REJECTED', 422);
  }
  unique(input.sources.map((source) => source.id));
  unique(input.offers.map((offer) => offer.id));
  requireCondition(
    input.baselineId === null || input.offers.some((offer) => offer.id === input.baselineId),
    'GROUND_BASELINE_NOT_FOUND',
    422,
  );
  requireCondition(
    mandatoryGroundCategories.every((category) => input.requiredCategories.includes(category)),
    'GROUND_REQUIRED_SCOPE_MISSING',
    422,
  );
  requireCondition(
    profile.minimumBreakfasts === null ||
      profile.minimumBreakfasts === 0 ||
      input.requiredCategories.includes('breakfast'),
    'GROUND_REQUIRED_SCOPE_MISSING',
    422,
  );
  const travelers =
    profile.adults === null || profile.children === null ? null : profile.adults + profile.children;
  requireCondition(travelers === null || travelers > 0, 'GROUND_PARTY_REJECTED', 422);
  requireCondition(profile.rooms === null || profile.rooms > 0, 'GROUND_ROOM_COUNT_REJECTED', 422);
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  for (const source of input.sources) {
    instant(source.observedAt);
    if (source.validUntil !== null) instant(source.validUntil);
    if (source.reviewAfter !== null) instant(source.reviewAfter);
  }
  const sourceFresh = (source: GroundSource) =>
    source.status === 'observed' &&
    instant(source.observedAt) <= now &&
    source.validUntil !== null &&
    instant(source.validUntil) >= now &&
    source.reviewAfter !== null &&
    instant(source.reviewAfter) >= now;
  const rows = input.offers.map((offer) => {
    requireCondition(
      [offer.origin, offer.destination, offer.provider].every(
        (value) => normalized(value).length > 0,
      ),
      'GROUND_LOCATION_REJECTED',
      422,
    );
    const pending: string[] = [],
      rejected: string[] = [],
      warnings: string[] = [];
    unique(offer.costs.map((cost) => cost.id));
    if (normalized(offer.origin) !== normalized(window.origin)) rejected.push('ORIGIN_MISMATCH');
    if (
      window.destination !== null &&
      normalized(offer.destination) !== normalized(window.destination)
    )
      rejected.push('DESTINATION_MISMATCH');
    if (!offer.yearConfirmed) pending.push('OFFER_YEAR_UNCONFIRMED');
    if (travelers === null) pending.push('PARTY_COMPOSITION_UNKNOWN');
    if (profile.rooms === null) pending.push('ROOM_COUNT_UNKNOWN');
    if (offer.available === false) rejected.push('NOT_AVAILABLE');
    else if (offer.available !== true) pending.push('AVAILABILITY_UNCONFIRMED');
    if (offer.requiredServicesConfirmed !== true) pending.push('REQUIRED_SERVICES_UNCONFIRMED');
    if (!offer.serviceScopeKey) pending.push('SERVICE_SCOPE_UNCONFIRMED');
    if (offer.cancellationPolicyKnown !== true) pending.push('CANCELLATION_POLICY_UNCONFIRMED');
    if (profile.accessibilityRequired && offer.accessibilityConfirmed !== true)
      pending.push('ACCESSIBILITY_UNCONFIRMED');
    const clocks = [
      offer.departureAt,
      offer.arrivalAtDestination,
      offer.returnDepartureAt,
      offer.returnToOriginAt,
    ].map((value) => (value === null ? null : instant(value)));
    const [departure, arrival, returnDeparture, returnArrival] = clocks;
    if (clocks.some((value) => value === null)) pending.push('JOURNEY_TIME_INCOMPLETE');
    if (departure !== null && departure !== undefined && (departure < from || departure > until))
      rejected.push('DEPARTURE_OUTSIDE_WINDOW');
    if (
      returnArrival !== null &&
      returnArrival !== undefined &&
      (returnArrival > until || returnArrival < from)
    )
      rejected.push('RETURN_ARRIVAL_OUTSIDE_WINDOW');
    if (returnArrival === null) pending.push('RETURN_TO_ORIGIN_UNKNOWN');
    for (let i = 1; i < clocks.length; i++) {
      if (clocks[i] !== null && clocks[i - 1] !== null && clocks[i]! < clocks[i - 1]!)
        rejected.push('JOURNEY_CHRONOLOGY_REJECTED');
    }
    if (departure !== null && departure !== undefined && departure < now)
      rejected.push('DEPARTURE_IN_PAST');
    const lodging = offer.lodging;
    let lodgingNights: number | null = null;
    if (lodging.checkIn !== null && lodging.checkOut !== null) {
      lodgingNights = date(lodging.checkIn).until(date(lodging.checkOut), {
        largestUnit: 'day',
      }).days;
      if (lodgingNights <= 0) rejected.push('LODGING_INTERVAL_REJECTED');
      if (lodging.declaredNights !== null && lodging.declaredNights !== lodgingNights)
        pending.push('LODGING_NIGHT_COUNT_CONFLICT');
      if (arrival !== null && arrival !== undefined) {
        const arrivalDate = Temporal.Instant.fromEpochMilliseconds(arrival)
          .toZonedDateTimeISO(window.timeZone)
          .toPlainDate();
        if (Temporal.PlainDate.compare(arrivalDate, date(lodging.checkIn)) > 0)
          pending.push('LODGING_BEFORE_ARRIVAL');
      }
      if (returnDeparture !== null && returnDeparture !== undefined) {
        const departureDate = Temporal.Instant.fromEpochMilliseconds(returnDeparture)
          .toZonedDateTimeISO(window.timeZone)
          .toPlainDate();
        if (Temporal.PlainDate.compare(departureDate, date(lodging.checkOut)) < 0)
          pending.push('LODGING_AFTER_RETURN_DEPARTURE');
      }
    } else pending.push('LODGING_DATES_UNKNOWN');
    if (
      profile.minimumLodgingNights !== null &&
      lodgingNights !== null &&
      lodgingNights < profile.minimumLodgingNights
    )
      rejected.push('INSUFFICIENT_LODGING_NIGHTS');
    if (lodging.roomType === 'unknown') pending.push('ROOM_TYPE_UNKNOWN');
    else if (profile.roomType !== 'any' && profile.roomType !== lodging.roomType)
      rejected.push('ROOM_TYPE_MISMATCH');
    if (
      lodging.occupancyConfirmed !== true ||
      lodging.occupantsPerRoom === null ||
      lodging.rooms === null
    )
      pending.push('OCCUPANCY_UNCONFIRMED');
    if (profile.rooms !== null && lodging.rooms !== null && profile.rooms !== lodging.rooms)
      rejected.push('ROOM_COUNT_MISMATCH');
    if (
      travelers !== null &&
      lodging.occupantsPerRoom !== null &&
      lodging.rooms !== null &&
      lodging.occupantsPerRoom * lodging.rooms < travelers
    )
      rejected.push('INSUFFICIENT_ROOM_CAPACITY');
    if (profile.minimumBreakfasts !== null && profile.minimumBreakfasts > 0) {
      if (lodging.breakfast === 'unknown' || lodging.includedBreakfasts === null)
        pending.push('BREAKFAST_UNCONFIRMED');
      else if (
        lodging.breakfast !== 'included' ||
        lodging.includedBreakfasts < profile.minimumBreakfasts
      )
        rejected.push('INSUFFICIENT_INCLUDED_BREAKFASTS');
    }
    if (
      lodging.includedBreakfasts !== null &&
      lodgingNights !== null &&
      lodging.includedBreakfasts >
        lodgingNights + (lodging.arrivalBreakfastIncluded === true ? 1 : 0)
    )
      pending.push('BREAKFAST_COUNT_SCOPE_CONFLICT');
    if (lodging.arrivalBreakfastIncluded !== true)
      warnings.push('ARRIVAL_BREAKFAST_OUTSIDE_HOTEL_RATE');
    if (lodging.nightsInTransit !== null && lodging.nightsInTransit > 0)
      warnings.push('TRANSIT_NIGHTS_ARE_NOT_LODGING_NIGHTS');
    let knownSubtotalMinor = 0,
      knownHoldsMinor = 0;
    const activeCosts = offer.costs.filter(
      (cost) => cost.treatment !== 'optional' || cost.selected,
    );
    const lineItems = activeCosts.map((cost) => {
      requireCondition(cost.currency === profile.currency, 'GROUND_CURRENCY_MISMATCH', 422);
      requireCondition(
        cost.sourceIds.every((id) => sources.has(id)),
        'GROUND_SOURCE_NOT_FOUND',
        422,
      );
      const missingAmount = cost.unitMinor === null;
      const totalMinor = missingAmount
        ? null
        : safeInteger(BigInt(cost.quantity) * BigInt(cost.unitMinor!));
      if (missingAmount) pending.push('COST_UNKNOWN:' + cost.id);
      if (
        cost.sourceIds.length === 0 ||
        !cost.sourceIds.every((id) => sourceFresh(sources.get(id)!))
      )
        pending.push('COST_PROVENANCE_UNCONFIRMED:' + cost.id);
      const expected =
        cost.unit === 'person'
          ? cost.personScope === 'adults'
            ? profile.adults
            : cost.personScope === 'children'
              ? profile.children
              : travelers
          : cost.unit === 'room_stay'
            ? profile.rooms
            : cost.unit === 'room_night'
              ? profile.rooms === null || lodgingNights === null
                ? null
                : profile.rooms * lodgingNights
              : 1;
      if (expected === null) pending.push('PRICE_UNIT_SCOPE_UNCONFIRMED:' + cost.id);
      else if (cost.quantity !== expected) pending.push('PRICE_UNIT_QUANTITY_MISMATCH:' + cost.id);
      if (totalMinor !== null) {
        if (cost.treatment === 'refundable_hold')
          knownHoldsMinor = safeInteger(BigInt(knownHoldsMinor) + BigInt(totalMinor));
        else knownSubtotalMinor = safeInteger(BigInt(knownSubtotalMinor) + BigInt(totalMinor));
      }
      return {
        id: cost.id,
        category: cost.category,
        unit: cost.unit,
        quantity: cost.quantity,
        personScope: cost.unit === 'person' ? (cost.personScope ?? 'party') : null,
        totalMinor,
        treatment: cost.treatment,
        sourceIds: cost.sourceIds,
      };
    });
    const ordinaryCosts = activeCosts.filter((cost) => cost.treatment !== 'refundable_hold');
    const coversParty = (costs: typeof ordinaryCosts) => {
      if (costs.some((cost) => cost.unit !== 'person')) return true;
      const scopes = new Set(costs.map((cost) => cost.personScope ?? 'party'));
      return (
        scopes.has('party') ||
        ((profile.adults === 0 || scopes.has('adults')) &&
          (profile.children === 0 || scopes.has('children')))
      );
    };
    const packageCosts = ordinaryCosts.filter((cost) => cost.category === 'package');
    if (packageCosts.length > 0 && !coversParty(packageCosts))
      pending.push('PARTY_PRICE_COVERAGE_INCOMPLETE:package');
    for (const category of groundCategories) {
      if (
        offer.coverage[category] === 'included' &&
        ordinaryCosts.some((cost) => cost.category === category)
      )
        pending.push('INCLUDED_COST_DUPLICATED:' + category);
    }
    const missingCategories: string[] = [];
    for (const category of input.requiredCategories) {
      const coverage = offer.coverage[category];
      if (coverage === 'unknown') missingCategories.push(category);
      if (coverage === 'included' && !ordinaryCosts.some((cost) => cost.category === 'package'))
        missingCategories.push(category);
      if (coverage === 'itemized' && !ordinaryCosts.some((cost) => cost.category === category))
        missingCategories.push(category);
      if (coverage === 'itemized') {
        const categoryCosts = ordinaryCosts.filter((cost) => cost.category === category);
        if (categoryCosts.length > 0 && !coversParty(categoryCosts))
          pending.push('PARTY_PRICE_COVERAGE_INCOMPLETE:' + category);
      }
      if (coverage === 'not_required' && !offer.notRequiredReasons[category]?.trim())
        missingCategories.push(category);
      if (
        ['outbound_bus', 'return_bus', 'lodging'].includes(category) &&
        coverage === 'not_required'
      )
        missingCategories.push(category);
      if (
        category === 'breakfast' &&
        (profile.minimumBreakfasts ?? 0) > 0 &&
        coverage === 'not_required'
      )
        missingCategories.push(category);
      if (
        category === 'arrival_breakfast' &&
        coverage === 'included' &&
        lodging.arrivalBreakfastIncluded !== true
      )
        missingCategories.push(category);
    }
    for (const category of missingCategories)
      pending.push('REQUIRED_COST_SCOPE_UNKNOWN:' + category);
    const pendingReasons = [...new Set(pending)],
      rejectionReasons = [...new Set(rejected)];
    const finalTotalMinor =
      pendingReasons.length || rejectionReasons.length ? null : knownSubtotalMinor;
    const knownCashExposureUpperBoundMinor = safeInteger(
      BigInt(knownSubtotalMinor) + BigInt(knownHoldsMinor),
    );
    const cashExposureUpperBoundMinor =
      finalTotalMinor === null ? null : knownCashExposureUpperBoundMinor;
    const equivalentKey = JSON.stringify({
      destination: normalized(offer.destination),
      adults: profile.adults,
      children: profile.children,
      checkIn: lodging.checkIn,
      checkOut: lodging.checkOut,
      roomType: lodging.roomType,
      rooms: lodging.rooms,
      occupancy: lodging.occupantsPerRoom,
      breakfast: lodging.breakfast,
      breakfasts: lodging.includedBreakfasts,
      requiredCategories: [...input.requiredCategories].sort(),
      serviceScopeKey: offer.serviceScopeKey ?? null,
      arrivalDate:
        arrival === null || arrival === undefined
          ? null
          : Temporal.Instant.fromEpochMilliseconds(arrival)
              .toZonedDateTimeISO(window.timeZone)
              .toPlainDate()
              .toString(),
      returnDate:
        returnDeparture === null || returnDeparture === undefined
          ? null
          : Temporal.Instant.fromEpochMilliseconds(returnDeparture)
              .toZonedDateTimeISO(window.timeZone)
              .toPlainDate()
              .toString(),
    });
    return {
      id: offer.id,
      provider: offer.provider,
      kind: offer.kind,
      destination: offer.destination,
      status: rejectionReasons.length
        ? 'rejected'
        : pendingReasons.length
          ? 'conditional'
          : 'documentary_comparable',
      pending: pendingReasons,
      rejected: rejectionReasons,
      warnings,
      currency: profile.currency,
      knownSubtotalMinor,
      knownPerPersonMinor: travelers === null ? null : ceil(knownSubtotalMinor, travelers),
      finalTotalMinor,
      lodgingNights,
      declaredLodgingNights: lodging.declaredNights,
      nightsInTransit: lodging.nightsInTransit,
      priceUnitScope:
        'Every quantity is explicitly billed; person=party, room_stay=rooms, room_night=rooms times calculated lodging nights, group=one.',
      knownHoldsMinor,
      knownCashExposureUpperBoundMinor,
      cashExposureUpperBoundMinor,
      budgetWithinLimit:
        profile.budgetMinor === null || finalTotalMinor === null
          ? null
          : finalTotalMinor <= profile.budgetMinor,
      conservativeCashBoundWithinLimit:
        profile.cashLimitMinor === null || cashExposureUpperBoundMinor === null
          ? null
          : cashExposureUpperBoundMinor <= profile.cashLimitMinor,
      cashWithinLimit: null,
      cashFlowStatus: 'not_modeled',
      affordability:
        profile.budgetMinor === null
          ? 'budget_not_supplied'
          : finalTotalMinor === null
            ? 'undetermined'
            : finalTotalMinor <= profile.budgetMinor
              ? 'within_declared_budget'
              : 'exceeds_declared_budget',
      departureAt: offer.departureAt,
      returnDepartureAt: offer.returnDepartureAt,
      returnToOriginAt: offer.returnToOriginAt,
      lineItems,
      comparisonKey: equivalentKey,
    };
  });
  const baseline = rows.find((row) => row.id === input.baselineId);
  const outputRows = rows.map(({ comparisonKey, ...row }) => {
    const comparable =
      !!baseline &&
      row.id !== baseline.id &&
      baseline.finalTotalMinor !== null &&
      row.finalTotalMinor !== null &&
      comparisonKey === baseline.comparisonKey;
    return {
      ...row,
      difference: {
        baselineId: input.baselineId,
        savingsMinor: comparable ? baseline!.finalTotalMinor! - row.finalTotalMinor! : null,
        reason: !baseline
          ? 'BASELINE_NOT_SELECTED'
          : row.id === baseline.id
            ? 'BASELINE'
            : comparable
              ? null
              : 'INCOMPLETE_OR_NON_EQUIVALENT_OFFERS',
      },
    };
  });
  const result = {
    rows: outputRows,
    travelerProfile: profile,
    requestedWindow: window,
    comparisonScope:
      'Identical destination, party, lodging dates and room scope, required services and observed complete costs. No inter-destination savings or undocumented zeroes.',
    cashScope:
      'Conservative sum of declared costs and refundable holds; not a dated cash-flow forecast. Holds are excluded from trip cost.',
    factsVerified: false,
    externalCalls: 0,
    inputProvenance: 'caller_declared',
    displayMarker: '[UNVERIFIED_HYPOTHESIS — HUMAN CHECK REQUIRED]',
    limits:
      'Source observation is not authentication. Published prices, eligibility, actual availability, cancellation enforceability and required local conditions need direct verification. Service level never weakens safety or accessibility checks.',
  };
  return {
    ...result,
    calculationReceipt: receipt('ground-transport', input, result, input.evaluatedAt),
  };
}
