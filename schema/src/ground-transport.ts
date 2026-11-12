import { identifier, integer, strictObject, timestamp } from './intelligence.js';

export const legacyGroundCategories = [
  'outbound_bus',
  'return_bus',
  'lodging',
  'breakfast',
  'arrival_breakfast',
  'local_transfers',
  'taxes',
  'mandatory_activities',
  'other_meals',
] as const;
export const flightGroundCategories = [
  'outbound_flight',
  'return_flight',
  'flight_baggage',
  'flight_seats',
  'airport_transfers',
] as const;
export const groundCategories = [...legacyGroundCategories, ...flightGroundCategories] as const;
export type GroundCategory = (typeof groundCategories)[number];
export type LegacyGroundCategory = (typeof legacyGroundCategories)[number];
export type FlightGroundCategory = (typeof flightGroundCategories)[number];
export const mandatorySharedCategories: readonly GroundCategory[] = [
  'lodging',
  'local_transfers',
  'taxes',
  'mandatory_activities',
];
export const mandatoryGroundCategories: readonly GroundCategory[] = [
  'outbound_bus',
  'return_bus',
  'lodging',
  'local_transfers',
  'taxes',
  'mandatory_activities',
];
const text = { type: 'string', minLength: 1, maxLength: 300 };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const count = { type: 'integer', minimum: 0, maximum: 1000 };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const ids = { type: 'array', items: identifier, uniqueItems: true, maxItems: 30 };
const categories = Object.fromEntries(
  groundCategories.map((key) => [
    key,
    { enum: ['included', 'itemized', 'not_required', 'unknown'] },
  ]),
);
const reasons = Object.fromEntries(groundCategories.map((key) => [key, text]));
const lodging = strictObject(
  {
    checkIn: nullable({ type: 'string', format: 'date' }),
    checkOut: nullable({ type: 'string', format: 'date' }),
    declaredNights: nullable(count),
    nightsInTransit: nullable(count),
    rooms: nullable(count),
    roomType: { enum: ['private', 'shared', 'unknown'] },
    occupantsPerRoom: nullable({ type: 'integer', minimum: 1, maximum: 100 }),
    occupancyConfirmed: { type: ['boolean', 'null'] },
    breakfast: { enum: ['included', 'excluded', 'unknown'] },
    includedBreakfasts: nullable(count),
    arrivalBreakfastIncluded: { type: ['boolean', 'null'] },
    externalBreakfasts: nullable(count),
  },
  [
    'checkIn',
    'checkOut',
    'declaredNights',
    'nightsInTransit',
    'rooms',
    'roomType',
    'occupantsPerRoom',
    'occupancyConfirmed',
    'breakfast',
    'includedBreakfasts',
    'arrivalBreakfastIncluded',
  ],
);
const source = strictObject({
  id: identifier,
  url: nullable({ type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 }),
  observedAt: timestamp,
  status: { enum: ['observed', 'indicative', 'historical', 'declared'] },
  validUntil: nullable(timestamp),
  reviewAfter: nullable(timestamp),
});
const cost = strictObject(
  {
    id: identifier,
    category: { enum: ['package', ...groundCategories] },
    unit: { enum: ['person', 'person_breakfast', 'room_night', 'room_stay', 'group'] },
    quantity: { type: 'integer', minimum: 1, maximum: 100000 },
    unitMinor: nullable(integer),
    currency,
    treatment: { enum: ['necessary', 'optional', 'refundable_hold'] },
    selected: { type: 'boolean' },
    sourceIds: ids,
    personScope: { enum: ['party', 'adults', 'children'] },
  },
  [
    'id',
    'category',
    'unit',
    'quantity',
    'unitMinor',
    'currency',
    'treatment',
    'selected',
    'sourceIds',
  ],
);
export const groundTransportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...strictObject({
    evaluatedAt: timestamp,
    baselineId: nullable(identifier),
    requestedWindow: strictObject({
      origin: text,
      destination: nullable(text),
      earliestDepartureAt: timestamp,
      latestReturnAt: timestamp,
      timeZone: { type: 'string', minLength: 1, maxLength: 100 },
    }),
    travelerProfile: strictObject(
      {
        serviceLevel: { enum: ['economic', 'balanced', 'executive', 'custom'] },
        adults: nullable(count),
        children: nullable(count),
        rooms: nullable(count),
        minimumLodgingNights: nullable(count),
        minimumBreakfasts: nullable(count),
        breakfastRequirement: { enum: ['hotel_included', 'provided_or_budgeted', 'not_required'] },
        roomType: { enum: ['private', 'shared', 'any'] },
        accessibilityRequired: { type: 'boolean' },
        budgetMinor: nullable(integer),
        cashLimitMinor: nullable(integer),
        currency,
      },
      [
        'serviceLevel',
        'adults',
        'children',
        'rooms',
        'minimumLodgingNights',
        'minimumBreakfasts',
        'roomType',
        'accessibilityRequired',
        'budgetMinor',
        'cashLimitMinor',
        'currency',
      ],
    ),
    requiredCategories: {
      type: 'array',
      uniqueItems: true,
      minItems: 6,
      maxItems: 14,
      items: { enum: groundCategories },
    },
    sources: { type: 'array', minItems: 1, maxItems: 100, items: source },
    offers: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: strictObject(
        {
          id: identifier,
          provider: text,
          kind: { enum: ['agency_package', 'independent'] },
          transportMode: { enum: ['bus', 'flight'] },
          origin: text,
          destination: text,
          destinationTimeZone: nullable({ type: 'string', minLength: 1, maxLength: 100 }),
          yearConfirmed: { type: 'boolean' },
          departureAt: nullable(timestamp),
          arrivalAtDestination: nullable(timestamp),
          returnDepartureAt: nullable(timestamp),
          returnToOriginAt: nullable(timestamp),
          lodging,
          available: { type: ['boolean', 'null'] },
          accessibilityConfirmed: { type: ['boolean', 'null'] },
          requiredServicesConfirmed: { type: ['boolean', 'null'] },
          cancellationPolicyKnown: { type: ['boolean', 'null'] },
          coverage: strictObject(categories, [...legacyGroundCategories]),
          notRequiredReasons: strictObject(reasons, []),
          costs: { type: 'array', minItems: 1, maxItems: 100, items: cost },
          serviceScopeKey: nullable(identifier),
        },
        [
          'id',
          'provider',
          'kind',
          'origin',
          'destination',
          'yearConfirmed',
          'departureAt',
          'arrivalAtDestination',
          'returnDepartureAt',
          'returnToOriginAt',
          'lodging',
          'available',
          'accessibilityConfirmed',
          'requiredServicesConfirmed',
          'cancellationPolicyKnown',
          'coverage',
          'notRequiredReasons',
          'costs',
        ],
      ),
    },
  }),
};
export interface GroundSource {
  id: string;
  url: string | null;
  observedAt: string;
  status: 'observed' | 'indicative' | 'historical' | 'declared';
  validUntil: string | null;
  reviewAfter: string | null;
}
export interface GroundCost {
  id: string;
  category: 'package' | GroundCategory;
  unit: 'person' | 'person_breakfast' | 'room_night' | 'room_stay' | 'group';
  quantity: number;
  unitMinor: number | null;
  currency: string;
  treatment: 'necessary' | 'optional' | 'refundable_hold';
  selected: boolean;
  sourceIds: string[];
  personScope?: 'party' | 'adults' | 'children';
}
export interface GroundOffer {
  id: string;
  provider: string;
  kind: 'agency_package' | 'independent';
  transportMode?: 'bus' | 'flight';
  origin: string;
  destination: string;
  destinationTimeZone?: string | null;
  yearConfirmed: boolean;
  departureAt: string | null;
  arrivalAtDestination: string | null;
  returnDepartureAt: string | null;
  returnToOriginAt: string | null;
  lodging: {
    checkIn: string | null;
    checkOut: string | null;
    declaredNights: number | null;
    nightsInTransit: number | null;
    rooms: number | null;
    roomType: 'private' | 'shared' | 'unknown';
    occupantsPerRoom: number | null;
    occupancyConfirmed: boolean | null;
    breakfast: 'included' | 'excluded' | 'unknown';
    includedBreakfasts: number | null;
    arrivalBreakfastIncluded: boolean | null;
    externalBreakfasts?: number | null;
  };
  available: boolean | null;
  accessibilityConfirmed: boolean | null;
  requiredServicesConfirmed: boolean | null;
  cancellationPolicyKnown: boolean | null;
  coverage: Record<LegacyGroundCategory, 'included' | 'itemized' | 'not_required' | 'unknown'> &
    Partial<Record<FlightGroundCategory, 'included' | 'itemized' | 'not_required' | 'unknown'>>;
  notRequiredReasons: Partial<Record<GroundCategory, string>>;
  costs: GroundCost[];
  serviceScopeKey?: string | null;
}
export interface GroundTransportInput {
  evaluatedAt: string;
  baselineId: string | null;
  requestedWindow: {
    origin: string;
    destination: string | null;
    earliestDepartureAt: string;
    latestReturnAt: string;
    timeZone: string;
  };
  travelerProfile: {
    serviceLevel: 'economic' | 'balanced' | 'executive' | 'custom';
    adults: number | null;
    children: number | null;
    rooms: number | null;
    minimumLodgingNights: number | null;
    minimumBreakfasts: number | null;
    breakfastRequirement?: 'hotel_included' | 'provided_or_budgeted' | 'not_required';
    roomType: 'private' | 'shared' | 'any';
    accessibilityRequired: boolean;
    budgetMinor: number | null;
    cashLimitMinor: number | null;
    currency: string;
  };
  requiredCategories: GroundCategory[];
  sources: GroundSource[];
  offers: GroundOffer[];
}
