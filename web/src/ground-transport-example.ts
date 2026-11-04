import type { GroundOffer, GroundTransportInput } from '../../schema/src/ground-transport.js';

const source = {
  id: 'source-synthetic',
  url: 'https://example.invalid/ground-quote',
  observedAt: '2030-01-01T12:00:00Z',
  status: 'observed' as const,
  validUntil: '2030-01-02T12:00:00Z',
  reviewAfter: '2030-01-02T12:00:00Z',
};
const packageOffer: GroundOffer = {
  id: 'synthetic-package',
  provider: 'Synthetic Local Agency',
  kind: 'agency_package',
  origin: 'Fictional Origin AAA',
  destination: 'Fictional Destination BBB',
  yearConfirmed: true,
  departureAt: '2030-06-13T06:00:00-03:00',
  arrivalAtDestination: '2030-06-13T14:00:00-03:00',
  returnDepartureAt: '2030-06-16T12:00:00-03:00',
  returnToOriginAt: '2030-06-16T20:00:00-03:00',
  lodging: {
    checkIn: '2030-06-13',
    checkOut: '2030-06-16',
    declaredNights: 3,
    nightsInTransit: 0,
    rooms: 1,
    roomType: 'private',
    occupantsPerRoom: 2,
    occupancyConfirmed: true,
    breakfast: 'included',
    includedBreakfasts: 3,
    arrivalBreakfastIncluded: false,
  },
  available: true,
  accessibilityConfirmed: true,
  requiredServicesConfirmed: true,
  cancellationPolicyKnown: true,
  serviceScopeKey: 'synthetic-equivalent-services',
  coverage: {
    outbound_bus: 'included',
    return_bus: 'included',
    lodging: 'included',
    breakfast: 'included',
    arrival_breakfast: 'not_required',
    local_transfers: 'included',
    taxes: 'included',
    mandatory_activities: 'not_required',
    other_meals: 'included',
  },
  notRequiredReasons: {
    arrival_breakfast: 'Synthetic arrival occurs after breakfast.',
    mandatory_activities: 'The synthetic itinerary contains no required paid activity.',
  },
  costs: [
    {
      id: 'package-price',
      category: 'package',
      unit: 'person',
      quantity: 2,
      unitMinor: 80000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
  ],
};
const independent: GroundOffer = {
  ...structuredClone(packageOffer),
  id: 'synthetic-independent',
  provider: 'Synthetic Independent Combination',
  kind: 'independent',
  coverage: {
    outbound_bus: 'itemized',
    return_bus: 'itemized',
    lodging: 'itemized',
    breakfast: 'itemized',
    arrival_breakfast: 'not_required',
    local_transfers: 'itemized',
    taxes: 'itemized',
    mandatory_activities: 'not_required',
    other_meals: 'itemized',
  },
  costs: [
    {
      id: 'bus-out',
      category: 'outbound_bus',
      unit: 'person',
      quantity: 2,
      unitMinor: 15000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    {
      id: 'bus-return',
      category: 'return_bus',
      unit: 'person',
      quantity: 2,
      unitMinor: 15000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    {
      id: 'hotel',
      category: 'lodging',
      unit: 'room_night',
      quantity: 3,
      unitMinor: 20000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    // Explicit synthetic inclusion evidence supports zero incremental breakfast/tax.
    {
      id: 'breakfast',
      category: 'breakfast',
      unit: 'group',
      quantity: 1,
      unitMinor: 0,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    {
      id: 'tax',
      category: 'taxes',
      unit: 'group',
      quantity: 1,
      unitMinor: 0,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    {
      id: 'transfers',
      category: 'local_transfers',
      unit: 'group',
      quantity: 1,
      unitMinor: 20000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
    {
      id: 'food',
      category: 'other_meals',
      unit: 'group',
      quantity: 1,
      unitMinor: 10000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
  ],
};
export const groundTransportExample: GroundTransportInput = {
  evaluatedAt: '2030-01-01T12:00:00Z',
  baselineId: packageOffer.id,
  requestedWindow: {
    origin: packageOffer.origin,
    destination: null,
    earliestDepartureAt: '2030-06-13T00:00:00-03:00',
    latestReturnAt: '2030-06-16T23:59:59-03:00',
    timeZone: 'America/Recife',
  },
  travelerProfile: {
    serviceLevel: 'economic',
    adults: 2,
    children: 0,
    rooms: 1,
    minimumLodgingNights: 3,
    minimumBreakfasts: 3,
    roomType: 'private',
    accessibilityRequired: false,
    budgetMinor: 170000,
    cashLimitMinor: 180000,
    currency: 'BRL',
  },
  requiredCategories: [
    'outbound_bus',
    'return_bus',
    'lodging',
    'breakfast',
    'local_transfers',
    'taxes',
    'mandatory_activities',
    'other_meals',
  ],
  sources: [source],
  offers: [packageOffer, independent],
};

// The legacy two-offer example above remains unchanged for compatibility.
// These five additional documentary scenarios are entirely synthetic.
const flightIncluded: GroundOffer = {
  ...structuredClone(independent),
  id: 'synthetic-flight-hotel-included',
  provider: 'Synthetic Flights and Hotel with Breakfast',
  transportMode: 'flight',
  destinationTimeZone: 'America/Recife',
  departureAt: '2030-06-13T08:00:00-03:00',
  arrivalAtDestination: '2030-06-13T11:00:00-03:00',
  returnDepartureAt: '2030-06-16T15:00:00-03:00',
  returnToOriginAt: '2030-06-16T18:00:00-03:00',
  lodging: { ...independent.lodging, externalBreakfasts: 0 },
  coverage: {
    ...independent.coverage,
    outbound_bus: 'not_required',
    return_bus: 'not_required',
    outbound_flight: 'itemized',
    return_flight: 'itemized',
    flight_baggage: 'included',
    flight_seats: 'not_required',
    airport_transfers: 'itemized',
  },
  notRequiredReasons: {
    ...independent.notRequiredReasons,
    outbound_bus: 'This synthetic choice uses flights rather than coaches.',
    return_bus: 'This synthetic choice uses flights rather than coaches.',
    flight_seats: 'No separately paid seat-selection service is required in this synthetic scope.',
  },
  costs: [
    ...independent.costs.map((cost) =>
      cost.category === 'outbound_bus' || cost.category === 'return_bus'
        ? {
            ...cost,
            id: cost.category === 'outbound_bus' ? 'flight-out' : 'flight-return',
            category:
              cost.category === 'outbound_bus'
                ? ('outbound_flight' as const)
                : ('return_flight' as const),
            unitMinor: 20000,
          }
        : { ...cost },
    ),
    {
      id: 'airport-transfers',
      category: 'airport_transfers',
      unit: 'group',
      quantity: 1,
      unitMinor: 10000,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: [source.id],
    },
  ],
};
const flightExternal: GroundOffer = {
  ...structuredClone(flightIncluded),
  id: 'synthetic-flight-hotel-external',
  provider: 'Synthetic Flights and Hotel plus Separate Breakfast Budget',
  lodging: {
    ...flightIncluded.lodging,
    breakfast: 'excluded',
    includedBreakfasts: 0,
    externalBreakfasts: 3,
  },
  costs: flightIncluded.costs.map((cost) =>
    cost.category === 'lodging'
      ? { ...cost, unitMinor: 15000 }
      : cost.category === 'breakfast'
        ? { ...cost, unit: 'person_breakfast', quantity: 6, unitMinor: 1500 }
        : { ...cost },
  ),
};
const incompleteFlight: GroundOffer = {
  ...structuredClone(flightExternal),
  id: 'synthetic-flight-unquoted-breakfast',
  provider: 'Synthetic Flights with Unquoted External Breakfast',
  costs: flightExternal.costs.map((cost) =>
    cost.category === 'breakfast' ? { ...cost, unitMinor: null } : { ...cost },
  ),
};
export const packageComparisonExample: GroundTransportInput = {
  ...structuredClone(groundTransportExample),
  travelerProfile: {
    ...groundTransportExample.travelerProfile,
    breakfastRequirement: 'provided_or_budgeted',
  },
  requiredCategories: [
    ...groundTransportExample.requiredCategories,
    'outbound_flight',
    'return_flight',
    'flight_baggage',
    'flight_seats',
    'airport_transfers',
  ],
  offers: [
    {
      ...structuredClone(packageOffer),
      transportMode: 'bus',
      lodging: { ...packageOffer.lodging, externalBreakfasts: 0 },
    },
    {
      ...structuredClone(independent),
      transportMode: 'bus',
      lodging: { ...independent.lodging, externalBreakfasts: 0 },
    },
    flightIncluded,
    flightExternal,
    incompleteFlight,
  ],
};
