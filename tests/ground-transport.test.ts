import { describe, expect, it } from 'vitest';
import { groundTransport } from '../api/src/ground-transport.js';
import { groundTransportExample } from '../web/src/ground-transport-example.js';
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
