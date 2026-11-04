import { describe, expect, it } from 'vitest';
import { groundTransport } from '../api/src/ground-transport.js';
import {
  groundTransportExample,
  packageComparisonExample,
} from '../web/src/ground-transport-example.js';
const input = () => structuredClone(groundTransportExample);
const alternative = (value = input()) => groundTransport(value).rows[1]!;

describe('road package versus independent stay', () => {
  it('reconciles person transport and room-night lodging without doubling room cost', () => {
    const result = alternative();
    expect(result.knownSubtotalMinor).toBe(150000);
    expect(result.knownPerPersonMinor).toBe(75000);
    expect(result.finalTotalMinor).toBe(150000);
    expect(result.difference.savingsMinor).toBe(10000);
    expect(result.lodgingNights).toBe(3);
  });
  it('does not call unknown bus prices free or claim savings from an incomplete quote', () => {
    const value = input();
    value.offers[1]!.costs[0]!.unitMinor = null;
    const row = alternative(value);
    expect(row.knownSubtotalMinor).toBe(120000);
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
    expect(row.pending).toContain('COST_UNKNOWN:bus-out');
  });
  it('preserves distinct adult and child prices without assuming a child entitlement', () => {
    const value = input();
    value.travelerProfile.children = 1;
    for (const offer of value.offers) offer.lodging.occupantsPerRoom = 3;
    value.offers[0]!.costs[0]!.quantity = 3;
    for (const line of value.offers[1]!.costs.filter((cost) => cost.unit === 'person'))
      line.personScope = 'adults';
    for (const category of ['outbound_bus', 'return_bus'] as const)
      value.offers[1]!.costs.push({
        id: 'synthetic-child-' + category,
        category,
        unit: 'person',
        personScope: 'children',
        quantity: 1,
        unitMinor: 10000,
        currency: 'BRL',
        treatment: 'necessary',
        selected: true,
        sourceIds: ['source-synthetic'],
      });
    const row = alternative(value);
    expect(row.finalTotalMinor).toBe(170000);
    expect(row.difference.savingsMinor).toBe(70000);
  });
  it('blocks complete totals when adult-only itemized prices omit a child tariff', () => {
    const value = input();
    value.travelerProfile.children = 1;
    for (const offer of value.offers) offer.lodging.occupantsPerRoom = 3;
    value.offers[0]!.costs[0]!.quantity = 3;
    for (const line of value.offers[1]!.costs.filter((cost) => cost.unit === 'person'))
      line.personScope = 'adults';
    const row = alternative(value);
    expect(row.knownSubtotalMinor).toBe(150000);
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
    expect(row.pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:outbound_bus');
    expect(row.pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:return_bus');
  });
  it('requires explicit sourced zero child tariffs and rejects missing adult coverage', () => {
    const value = input();
    value.travelerProfile.children = 1;
    for (const offer of value.offers) offer.lodging.occupantsPerRoom = 3;
    value.offers[0]!.costs[0]!.quantity = 3;
    for (const line of value.offers[1]!.costs.filter((cost) => cost.unit === 'person'))
      line.personScope = 'adults';
    for (const category of ['outbound_bus', 'return_bus'] as const)
      value.offers[1]!.costs.push({
        id: 'explicit-zero-child-' + category,
        category,
        unit: 'person',
        personScope: 'children',
        quantity: 1,
        unitMinor: 0,
        currency: 'BRL',
        treatment: 'necessary',
        selected: true,
        sourceIds: ['source-synthetic'],
      });
    expect(alternative(value).finalTotalMinor).toBe(150000);
    value.offers[1]!.costs = value.offers[1]!.costs.filter(
      (cost) => cost.unit !== 'person' || cost.personScope !== 'adults',
    );
    expect(alternative(value).pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:outbound_bus');
    expect(alternative(value).finalTotalMinor).toBeNull();
  });
  it('blocks adult-only package prices when the party also contains a child', () => {
    const value = input();
    value.travelerProfile.children = 1;
    for (const offer of value.offers) offer.lodging.occupantsPerRoom = 3;
    value.offers[0]!.costs[0]!.personScope = 'adults';
    for (const line of value.offers[1]!.costs.filter((cost) => cost.unit === 'person'))
      line.quantity = 3;
    const result = groundTransport(value);
    expect(result.rows[0]!.pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:package');
    expect(result.rows[0]!.finalTotalMinor).toBeNull();
    expect(result.rows[1]!.difference.savingsMinor).toBeNull();
  });
  it('uses arrival home rather than departure from the destination for the date limit', () => {
    const value = input();
    value.offers[0]!.returnToOriginAt = '2030-06-17T04:00:00-03:00';
    const row = groundTransport(value).rows[0]!;
    expect(row.status).toBe('rejected');
    expect(row.rejected).toContain('RETURN_ARRIVAL_OUTSIDE_WINDOW');
    value.offers[0]!.returnToOriginAt = null;
    expect(groundTransport(value).rows[0]!.pending).toContain('RETURN_TO_ORIGIN_UNKNOWN');
  });
  it('does not infer the offered year from similar day/month or site headings', () => {
    const value = input();
    value.offers[0]!.yearConfirmed = false;
    expect(groundTransport(value).rows[0]!.finalTotalMinor).toBeNull();
    value.offers[0]!.departureAt = '2027-06-13T06:00:00-03:00';
    expect(groundTransport(value).rows[0]!.rejected).toContain('DEPARTURE_OUTSIDE_WINDOW');
  });
  it('keeps shared occupancy and room-price assumptions unresolved', () => {
    const value = input();
    value.offers[0]!.lodging.occupancyConfirmed = null;
    expect(groundTransport(value).rows[0]!.pending).toContain('OCCUPANCY_UNCONFIRMED');
    value.offers[1]!.costs[2]!.unit = 'person';
    value.offers[1]!.costs[2]!.quantity = 3;
    expect(alternative(value).pending).toContain('PRICE_UNIT_QUANTITY_MISMATCH:hotel');
  });
  it('calculates lodging nights from dates, not nights spent on a bus', () => {
    const value = input();
    value.offers[0]!.lodging.declaredNights = 4;
    value.offers[0]!.lodging.nightsInTransit = 1;
    const row = groundTransport(value).rows[0]!;
    expect(row.lodgingNights).toBe(3);
    expect(row.pending).toContain('LODGING_NIGHT_COUNT_CONFLICT');
    expect(row.warnings).toContain('TRANSIT_NIGHTS_ARE_NOT_LODGING_NIGHTS');
  });
  it('does not promote a breakfast filter or missing first-morning meal into an inclusion', () => {
    const value = input();
    value.offers[1]!.lodging.breakfast = 'unknown';
    expect(alternative(value).pending).toContain('BREAKFAST_UNCONFIRMED');
    const arrival = input();
    arrival.requiredCategories.push('arrival_breakfast');
    arrival.offers[0]!.coverage.arrival_breakfast = 'included';
    expect(groundTransport(arrival).rows[0]!.pending).toContain(
      'REQUIRED_COST_SCOPE_UNKNOWN:arrival_breakfast',
    );
  });
  it('caps breakfast count by calculated nights plus one explicitly included arrival morning', () => {
    const value = input();
    value.travelerProfile.minimumBreakfasts = 99;
    for (const offer of value.offers) {
      offer.lodging.includedBreakfasts = 99;
      offer.lodging.arrivalBreakfastIncluded = true;
    }
    expect(
      groundTransport(value).rows.every(
        (row) =>
          row.finalTotalMinor === null && row.pending.includes('BREAKFAST_COUNT_SCOPE_CONFLICT'),
      ),
    ).toBe(true);
    const possible = input();
    possible.offers[0]!.lodging.includedBreakfasts = 4;
    possible.offers[0]!.lodging.arrivalBreakfastIncluded = true;
    expect(groundTransport(possible).rows[0]!.pending).not.toContain(
      'BREAKFAST_COUNT_SCOPE_CONFLICT',
    );
  });
  it('blocks an additional ordinary charge for a service already included in package price', () => {
    const value = input();
    value.offers[0]!.costs.push({
      id: 'duplicate-lodging',
      category: 'lodging',
      unit: 'room_night',
      quantity: 3,
      unitMinor: 10000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: ['source-synthetic'],
    });
    const result = groundTransport(value);
    expect(result.rows[0]!.pending).toContain('INCLUDED_COST_DUPLICATED:lodging');
    expect(result.rows[0]!.finalTotalMinor).toBeNull();
    expect(result.rows[1]!.difference.savingsMinor).toBeNull();
  });
  it('requires prices for mandatory activities and prevents removing obligatory categories', () => {
    const value = input();
    value.offers[1]!.coverage.mandatory_activities = 'itemized';
    expect(alternative(value).pending).toContain(
      'REQUIRED_COST_SCOPE_UNKNOWN:mandatory_activities',
    );
    value.requiredCategories = [
      'outbound_bus',
      'return_bus',
      'lodging',
      'breakfast',
      'taxes',
      'other_meals',
    ];
    expect(() => groundTransport(value)).toThrow('GROUND_REQUIRED_SCOPE_MISSING');
  });
  it('never reports inter-destination savings or mismatched service scope', () => {
    const value = input();
    value.offers[1]!.destination = 'Another Fictional Destination';
    expect(alternative(value).difference.savingsMinor).toBeNull();
    const services = input();
    services.offers[1]!.serviceScopeKey = 'different-services';
    expect(alternative(services).difference.savingsMinor).toBeNull();
  });
  it('requires availability and current observed quote provenance', () => {
    const value = input();
    value.offers[1]!.available = null;
    expect(alternative(value).finalTotalMinor).toBeNull();
    const stale = input();
    stale.sources[0]!.status = 'historical';
    expect(
      alternative(stale).pending.some((code) => code.startsWith('COST_PROVENANCE_UNCONFIRMED:')),
    ).toBe(true);
  });
  it('preserves unknown budget/party and identical safety rules for economic and executive profiles', () => {
    const value = input();
    value.travelerProfile.budgetMinor = null;
    expect(alternative(value).budgetWithinLimit).toBeNull();
    value.travelerProfile.adults = null;
    expect(alternative(value).finalTotalMinor).toBeNull();
    const economic = input();
    economic.travelerProfile.accessibilityRequired = true;
    economic.offers[1]!.accessibilityConfirmed = false;
    const executive = structuredClone(economic);
    executive.travelerProfile.serviceLevel = 'executive';
    expect(alternative(economic).pending).toEqual(alternative(executive).pending);
    expect(alternative(executive).pending).toContain('ACCESSIBILITY_UNCONFIRMED');
  });
  it('separates refundable holds from trip cost and exposes the cash upper bound', () => {
    const value = input();
    value.offers[1]!.costs.push({
      id: 'hold',
      category: 'lodging',
      unit: 'group',
      quantity: 1,
      unitMinor: 40000,
      currency: 'BRL',
      treatment: 'refundable_hold',
      selected: true,
      sourceIds: ['source-synthetic'],
    });
    const row = alternative(value);
    expect(row.finalTotalMinor).toBe(150000);
    expect(row.cashExposureUpperBoundMinor).toBe(190000);
    expect(row.budgetWithinLimit).toBe(true);
    expect(row.conservativeCashBoundWithinLimit).toBe(false);
    expect(row.cashWithinLimit).toBeNull();
    expect(row.cashFlowStatus).toBe('not_modeled');
  });
  it('rejects mixed currency, extra instructions and unsafe integer arithmetic', () => {
    const value = input();
    value.offers[1]!.costs[0]!.currency = 'USD';
    expect(() => groundTransport(value)).toThrow('GROUND_CURRENCY_MISMATCH');
    expect(() => groundTransport({ ...input(), executeImportedInstruction: true })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    const overflow = input();
    overflow.offers[1]!.costs[0]!.unitMinor = Number.MAX_SAFE_INTEGER;
    expect(() => groundTransport(overflow)).toThrow('INTELLIGENCE_INTEGER_OVERFLOW');
  });
  it('rejects blank locations instead of creating inter-offer equivalence from empty strings', () => {
    const value = input();
    value.offers[0]!.destination = '   ';
    value.offers[1]!.destination = '\u00a0';
    expect(() => groundTransport(value)).toThrow('GROUND_LOCATION_REJECTED');
    const origin = input();
    origin.requestedWindow.origin = '\t';
    expect(() => groundTransport(origin)).toThrow('GROUND_LOCATION_REJECTED');
    const provider = input();
    provider.offers[0]!.provider = ' ';
    expect(() => groundTransport(provider)).toThrow('GROUND_LOCATION_REJECTED');
  });
});

describe('bus or flight packages and breakfast-equivalent comparisons', () => {
  const comparison = () => structuredClone(packageComparisonExample);
  it('compares five synthetic alternatives without treating airfare as a coach price', () => {
    const rows = groundTransport(comparison()).rows;
    expect(rows.map((row) => row.transportMode)).toEqual([
      'bus',
      'bus',
      'flight',
      'flight',
      'flight',
    ]);
    expect(rows.map((row) => row.finalTotalMinor)).toEqual([160000, 150000, 180000, 174000, null]);
    // Flights against the coach package are nominal differences, never savings.
    expect(rows.map((row) => row.difference.savingsMinor)).toEqual([null, 10000, null, null, null]);
    expect(rows.slice(2).map((row) => row.difference.reason)).toEqual([
      'TRANSPORT_MODE_DIFFERS',
      'TRANSPORT_MODE_DIFFERS',
      'TRANSPORT_MODE_DIFFERS',
    ]);
    expect(rows[2]!.lineItems.some((line) => line.category === 'outbound_flight')).toBe(true);
    expect(rows[2]!.lineItems.some((line) => line.category === 'outbound_bus')).toBe(false);
  });
  it('equates hotel-included and explicitly priced external breakfasts only under the declared policy', () => {
    const value = comparison();
    // Same mode on both sides, so only the breakfast arrangement differs.
    value.baselineId = 'synthetic-flight-hotel-included';
    const result = groundTransport(value);
    expect(result.rows[0]!.providedBreakfasts).toBe(3);
    expect(result.rows[3]!.providedBreakfasts).toBe(3);
    expect(result.rows[3]!.hotelBreakfast).toBe('excluded');
    expect(result.rows[3]!.externalBreakfasts).toBe(3);
    expect(
      result.rows[3]!.lineItems.find((line) => line.category === 'breakfast')!.totalMinor,
    ).toBe(9000);
    expect(result.rows[3]!.difference.savingsMinor).toBe(6000);
  });
  it('does not use separately budgeted breakfast to satisfy a hotel-included requirement', () => {
    const value = comparison();
    value.travelerProfile.breakfastRequirement = 'hotel_included';
    const row = groundTransport(value).rows[3]!;
    expect(row.rejected).toContain('INSUFFICIENT_INCLUDED_BREAKFASTS');
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
  });
  it('does not infer unpriced external meals or their quantities', () => {
    const value = comparison();
    delete value.offers[3]!.lodging.externalBreakfasts;
    let row = groundTransport(value).rows[3]!;
    expect(row.pending).toContain('EXTERNAL_BREAKFAST_COUNT_UNKNOWN');
    expect(row.finalTotalMinor).toBeNull();
    const amount = comparison();
    amount.offers[3]!.costs.find((line) => line.category === 'breakfast')!.unitMinor = null;
    row = groundTransport(amount).rows[3]!;
    expect(row.pending).toContain('COST_UNKNOWN:breakfast');
    expect(row.difference.savingsMinor).toBeNull();
  });
  it('preserves an explicit unknown external breakfast count instead of converting null to zero', () => {
    const value = comparison();
    value.offers[2]!.lodging.externalBreakfasts = null;
    const row = groundTransport(value).rows[2]!;
    expect(row.externalBreakfasts).toBeNull();
    expect(row.providedBreakfasts).toBeNull();
    expect(row.pending).toContain('EXTERNAL_BREAKFAST_COUNT_UNKNOWN');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('reconciles person-breakfast units as party times explicit meal count', () => {
    const value = comparison();
    value.offers[3]!.costs.find((line) => line.category === 'breakfast')!.quantity = 3;
    const row = groundTransport(value).rows[3]!;
    expect(row.pending).toContain('PRICE_UNIT_QUANTITY_MISMATCH:breakfast');
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
  });
  it('does not omit children from externally purchased breakfasts', () => {
    const value = comparison();
    value.baselineId = null;
    value.offers = [value.offers[3]!];
    value.travelerProfile.children = 1;
    const offer = value.offers[0]!;
    offer.lodging.occupantsPerRoom = 3;
    for (const line of offer.costs.filter((cost) => cost.unit === 'person')) line.quantity = 3;
    offer.costs.find((cost) => cost.category === 'breakfast')!.personScope = 'adults';
    let row = groundTransport(value).rows[0]!;
    expect(row.pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:breakfast');
    expect(row.finalTotalMinor).toBeNull();
    offer.costs.push({
      id: 'external-child-breakfast',
      category: 'breakfast',
      unit: 'person_breakfast',
      personScope: 'children',
      quantity: 3,
      unitMinor: 500,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: ['source-synthetic'],
    });
    row = groundTransport(value).rows[0]!;
    expect(row.pending).not.toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:breakfast');
    expect(row.finalTotalMinor).not.toBeNull();
  });
  it('requires explicit airfare legs and does not reuse coach costs for a flight', () => {
    const value = comparison();
    value.requiredCategories = value.requiredCategories.filter(
      (category) => category !== 'return_flight',
    );
    expect(() => groundTransport(value)).toThrow('GROUND_REQUIRED_SCOPE_MISSING');
    const wrong = comparison();
    wrong.offers[2]!.costs.find((cost) => cost.category === 'outbound_flight')!.category =
      'outbound_bus';
    const row = groundTransport(wrong).rows[2]!;
    expect(row.pending).toContain('TRANSPORT_MODE_COST_CONFLICT:outbound_bus');
    expect(row.pending).toContain('REQUIRED_COST_SCOPE_UNKNOWN:outbound_flight');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('requires flight baggage, seat and airport-transfer scope even when omitted from requiredCategories', () => {
    const value = comparison();
    value.requiredCategories = value.requiredCategories.filter(
      (category) => !['flight_baggage', 'flight_seats', 'airport_transfers'].includes(category),
    );
    const flight = value.offers[2]!;
    delete flight.coverage.flight_baggage;
    delete flight.coverage.flight_seats;
    delete flight.coverage.airport_transfers;
    const row = groundTransport(value).rows[2]!;
    expect(row.pending).toContain('REQUIRED_COST_SCOPE_UNKNOWN:flight_baggage');
    expect(row.pending).toContain('REQUIRED_COST_SCOPE_UNKNOWN:flight_seats');
    expect(row.pending).toContain('REQUIRED_COST_SCOPE_UNKNOWN:airport_transfers');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('accepts baggage explicitly included in the priced fares and documented unneeded seat selection', () => {
    const value = comparison();
    const row = groundTransport(value).rows[2]!;
    expect(row.finalTotalMinor).toBe(180000);
    expect(row.lineItems.some((cost) => cost.category === 'flight_baggage')).toBe(false);
    value.offers[2]!.notRequiredReasons.flight_seats = '   ';
    expect(groundTransport(value).rows[2]!.finalTotalMinor).toBeNull();
  });
  it('keeps breakfast-excluded offers visible without claiming savings against unequal hotel amenities', () => {
    const value = input();
    value.travelerProfile.minimumBreakfasts = 0;
    value.travelerProfile.breakfastRequirement = 'not_required';
    value.requiredCategories = value.requiredCategories.filter(
      (category) => category !== 'breakfast',
    );
    const offer = value.offers[1]!;
    offer.lodging.breakfast = 'excluded';
    offer.lodging.includedBreakfasts = 0;
    offer.lodging.externalBreakfasts = 0;
    offer.coverage.breakfast = 'not_required';
    offer.notRequiredReasons.breakfast = 'No breakfasts are requested in this synthetic scenario.';
    offer.costs = offer.costs.filter((cost) => cost.category !== 'breakfast');
    const rows = groundTransport(value).rows;
    expect(rows[1]!.finalTotalMinor).toBe(150000);
    expect(rows[1]!.hotelBreakfast).toBe('excluded');
    expect(rows[1]!.difference.savingsMinor).toBeNull();
    expect(rows[1]!.difference.reason).toBe('INCOMPLETE_OR_NON_EQUIVALENT_OFFERS');
  });
  it('rejects a not-required breakfast policy with a positive minimum', () => {
    const value = comparison();
    value.travelerProfile.breakfastRequirement = 'not_required';
    expect(() => groundTransport(value)).toThrow('GROUND_BREAKFAST_POLICY_CONFLICT');
  });
  it('does not let unselected optional external breakfast complete the food budget', () => {
    const value = comparison();
    const line = value.offers[3]!.costs.find((cost) => cost.category === 'breakfast')!;
    line.treatment = 'optional';
    line.selected = false;
    const row = groundTransport(value).rows[3]!;
    expect(row.pending).toContain('REQUIRED_COST_SCOPE_UNKNOWN:breakfast');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('caps total included and external breakfasts without charging the same service twice', () => {
    const value = comparison();
    value.offers[2]!.lodging.externalBreakfasts = 3;
    const row = groundTransport(value).rows[2]!;
    expect(row.pending).toContain('BREAKFAST_COUNT_SCOPE_CONFLICT');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('accepts explicitly sourced zero external breakfast prices without inventing them', () => {
    const value = comparison();
    const line = value.offers[3]!.costs.find((cost) => cost.category === 'breakfast')!;
    line.unitMinor = 0;
    expect(groundTransport(value).rows[3]!.finalTotalMinor).toBe(165000);
    line.sourceIds = [];
    expect(groundTransport(value).rows[3]!.finalTotalMinor).toBeNull();
  });
  it('keeps malformed modes and passive injection fields outside the strict contract', () => {
    const value = comparison();
    expect(() => groundTransport({ ...value, runInstructions: 'untrusted' })).toThrow(
      'INTELLIGENCE_SCHEMA_REJECTED',
    );
    (value.offers[2] as unknown as { transportMode: string }).transportMode = 'teleport';
    expect(() => groundTransport(value)).toThrow('INTELLIGENCE_SCHEMA_REJECTED');
  });
  it('requires a destination IANA zone for flight hotel dates instead of silently using the origin zone', () => {
    const value = comparison();
    delete value.offers[2]!.destinationTimeZone;
    expect(groundTransport(value).rows[2]!.pending).toContain('DESTINATION_TIME_ZONE_UNCONFIRMED');
    value.offers[2]!.destinationTimeZone = 'Unknown/Invalid';
    expect(() => groundTransport(value)).toThrow('GROUND_DESTINATION_TIME_ZONE_REJECTED');
  });
  it('uses the declared destination local day for lodging and equivalence across a timezone boundary', () => {
    const value = comparison();
    value.baselineId = null;
    value.offers = [value.offers[2]!];
    const flight = value.offers[0]!;
    flight.destinationTimeZone = 'America/New_York';
    // In Recife this is 14 June; in the declared destination it is still 13 June.
    flight.arrivalAtDestination = '2030-06-14T03:30:00Z';
    const row = groundTransport(value).rows[0]!;
    expect(row.pending).not.toContain('LODGING_BEFORE_ARRIVAL');
    expect(row.finalTotalMinor).toBe(180000);
    flight.destinationTimeZone = 'America/Recife';
    expect(groundTransport(value).rows[0]!.pending).toContain('LODGING_BEFORE_ARRIVAL');
  });
  it('treats a rate declared without breakfast as zero hotel breakfasts, not as unconfirmed', () => {
    const value = comparison();
    value.offers[3]!.lodging.includedBreakfasts = null;
    const row = groundTransport(value).rows[3]!;
    expect(row.pending).not.toContain('BREAKFAST_UNCONFIRMED');
    expect(row).toMatchObject({
      hotelBreakfasts: 0,
      providedBreakfasts: 3,
      finalTotalMinor: 174000,
    });
    value.travelerProfile.breakfastRequirement = 'hotel_included';
    const strict = groundTransport(value).rows[3]!;
    expect(strict.rejected).toContain('INSUFFICIENT_INCLUDED_BREAKFASTS');
    expect(strict.pending).not.toContain('BREAKFAST_UNCONFIRMED');
  });
  it('accepts only IANA names for the window and destination zones, as the trip contract does', () => {
    for (const zone of ['-03:00', '+0000', 'america/recife', '2030-06-13T08:00:00-03:00']) {
      const destination = comparison();
      destination.offers[2]!.destinationTimeZone = zone;
      expect(() => groundTransport(destination), zone).toThrow(
        'GROUND_DESTINATION_TIME_ZONE_REJECTED',
      );
      const window = comparison();
      window.requestedWindow.timeZone = zone;
      expect(() => groundTransport(window), zone).toThrow('GROUND_TIME_ZONE_REJECTED');
    }
  });
  it('flags the coach fallback to the window zone instead of applying it silently', () => {
    const value = comparison();
    value.offers[1]!.destinationTimeZone = null;
    expect(groundTransport(value).rows[1]!.warnings).toContain(
      'DESTINATION_TIME_ZONE_ASSUMED_FROM_WINDOW',
    );
    expect(groundTransport(value).rows[1]!.pending).not.toContain(
      'DESTINATION_TIME_ZONE_UNCONFIRMED',
    );
    value.offers[1]!.destinationTimeZone = 'America/Recife';
    expect(groundTransport(value).rows[1]!.warnings).not.toContain(
      'DESTINATION_TIME_ZONE_ASSUMED_FROM_WINDOW',
    );
  });
});

describe('complete-trip costs cannot omit selected meals or destination nights', () => {
  const externallyBudgeted = () => {
    const value = input();
    value.travelerProfile.breakfastRequirement = 'provided_or_budgeted';
    value.travelerProfile.minimumBreakfasts = 0;
    value.requiredCategories = value.requiredCategories.filter(
      (category) => category !== 'breakfast',
    );
    const offer = value.offers[1]!;
    offer.lodging.includedBreakfasts = 1;
    offer.lodging.externalBreakfasts = 2;
    return value;
  };
  it('requires priced external breakfasts even when no minimum or required category was selected', () => {
    const value = externallyBudgeted();
    value.offers[1]!.costs = value.offers[1]!.costs.filter((cost) => cost.category !== 'breakfast');
    const row = alternative(value);
    expect(row.knownSubtotalMinor).toBe(150000);
    expect(row.providedBreakfasts).toBe(3);
    expect(row.pending).toContain('EXTERNAL_BREAKFAST_COST_SCOPE_UNKNOWN');
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
  });
  it('does not call a whole-group breakfast budget complete when its external meal count is unknown', () => {
    const value = externallyBudgeted();
    value.offers[1]!.lodging.externalBreakfasts = null;
    const row = alternative(value);
    expect(row.pending).toContain('EXTERNAL_BREAKFAST_COUNT_UNKNOWN');
    expect(row.finalTotalMinor).toBeNull();
    expect(row.difference.savingsMinor).toBeNull();
  });
  it.each(['unselected_optional', 'refundable_hold'] as const)(
    'does not replace the external food cost with %s',
    (treatment) => {
      const value = externallyBudgeted();
      const breakfast = value.offers[1]!.costs.find((cost) => cost.category === 'breakfast')!;
      breakfast.treatment = treatment === 'unselected_optional' ? 'optional' : 'refundable_hold';
      breakfast.selected = false;
      const row = alternative(value);
      expect(row.pending).toContain('EXTERNAL_BREAKFAST_COST_SCOPE_UNKNOWN');
      expect(row.finalTotalMinor).toBeNull();
    },
  );
  it('requires explicit meal units and child coverage for external breakfasts outside requiredCategories', () => {
    const value = externallyBudgeted();
    value.travelerProfile.children = 1;
    for (const offer of value.offers) offer.lodging.occupantsPerRoom = 3;
    value.offers[0]!.costs[0]!.quantity = 3;
    for (const line of value.offers[1]!.costs.filter((cost) => cost.unit === 'person'))
      line.quantity = 3;
    const breakfast = value.offers[1]!.costs.find((cost) => cost.category === 'breakfast')!;
    breakfast.unit = 'person_breakfast';
    breakfast.personScope = 'adults';
    breakfast.quantity = 4;
    breakfast.unitMinor = 1500;
    let row = alternative(value);
    expect(row.pending).toContain('PARTY_PRICE_COVERAGE_INCOMPLETE:breakfast');
    expect(row.finalTotalMinor).toBeNull();
    breakfast.personScope = 'party';
    breakfast.quantity = 6;
    row = alternative(value);
    expect(row.finalTotalMinor).toBe(189000);
    breakfast.unit = 'room_night';
    breakfast.quantity = 3;
    row = alternative(value);
    expect(row.pending).toContain('EXTERNAL_BREAKFAST_PRICE_UNIT_UNCONFIRMED');
    expect(row.finalTotalMinor).toBeNull();
  });
  it('accepts a sourced whole-group meal total, while rejecting wrong quantity or absent provenance', () => {
    const value = externallyBudgeted();
    const breakfast = value.offers[1]!.costs.find((cost) => cost.category === 'breakfast')!;
    breakfast.unit = 'group';
    breakfast.quantity = 1;
    breakfast.unitMinor = 12000;
    expect(alternative(value).finalTotalMinor).toBe(162000);
    breakfast.quantity = 2;
    expect(alternative(value).finalTotalMinor).toBeNull();
    breakfast.quantity = 1;
    breakfast.sourceIds = [];
    expect(alternative(value).finalTotalMinor).toBeNull();
  });
  it('keeps explicitly sourced zero-price meals distinct from omitted external costs', () => {
    const value = externallyBudgeted();
    expect(alternative(value).finalTotalMinor).toBe(150000);
    value.offers[1]!.costs.find((cost) => cost.category === 'breakfast')!.unitMinor = null;
    expect(alternative(value).finalTotalMinor).toBeNull();
  });
  it.each(['before', 'after'] as const)(
    'blocks complete trip totals when a destination night lies %s the hotel stay',
    (gap) => {
      const value = input();
      value.travelerProfile.minimumLodgingNights = 2;
      value.travelerProfile.minimumBreakfasts = 2;
      for (const offer of value.offers) {
        offer.lodging.checkIn = gap === 'before' ? '2030-06-14' : '2030-06-13';
        offer.lodging.checkOut = gap === 'before' ? '2030-06-16' : '2030-06-15';
        offer.lodging.declaredNights = 2;
        offer.lodging.includedBreakfasts = 2;
        offer.lodging.nightsInTransit = 0;
        for (const line of offer.costs) if (line.unit === 'room_night') line.quantity = 2;
      }
      const row = alternative(value);
      expect(row.lodgingNights).toBe(2);
      expect(row.knownSubtotalMinor).toBe(130000);
      expect(row.pending).toContain(
        gap === 'before'
          ? 'OVERNIGHT_BEFORE_LODGING_UNCONFIRMED'
          : 'OVERNIGHT_AFTER_LODGING_UNCONFIRMED',
      );
      expect(row.finalTotalMinor).toBeNull();
      expect(row.difference.savingsMinor).toBeNull();
      value.offers[1]!.lodging.nightsInTransit = 1;
      expect(alternative(value).finalTotalMinor).toBeNull();
    },
  );
});
