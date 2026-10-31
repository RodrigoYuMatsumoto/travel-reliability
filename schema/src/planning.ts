/** Pseudonymous, documentary planning inputs. No booking or messaging capabilities. */
import { localeSchema } from './locale.js';
export const toolIds = [
  'flex-dates',
  'airports',
  'connections',
  'promotions',
  'total-cost',
  'fare-scenarios',
  'negotiation',
  'hidden-city',
  'group-split',
] as const;
export type ToolId = (typeof toolIds)[number];
export interface Source {
  id: string;
  url: string | null;
  observedAt: string;
  status: 'observed' | 'indicative' | 'historical' | 'declared';
  note: string;
}
export interface CostItem {
  id: string;
  label: string;
  unit: string;
  quantity: number;
  unitMinor: number | null;
  currency: string;
  treatment: 'included' | 'necessary' | 'optional' | 'conditional';
  selected: boolean;
  sourceIds: string[];
}
export interface Offer {
  id: string;
  seller: string;
  operator: string;
  origin: string;
  destination: string;
  departure: string;
  arrival: string;
  returnDeparture: string | null;
  destinationArrivalDate: string;
  destinationDepartureDate: string | null;
  passengers: string;
  cabin: string;
  baggage: string;
  requiredServices: string;
  paymentCategory: string;
  capacityConfirmed: boolean | null;
  validUntil: string | null;
  sources: Source[];
  costs: CostItem[];
  airport: string;
  groundDistanceKm: number | null;
  groundMinutes: number | null;
  overnight: boolean;
  ticketStructure: 'single' | 'separate' | 'unknown';
  connectionProtectionSourceId: string | null;
  connections: Array<{
    arrival: string;
    departure: string;
    minimumMinutes: number | null;
    basis: string | null;
    sourceId: string | null;
    airportChange: boolean;
    baggageRecheck: boolean | null;
    entryPermission: 'confirmed' | 'not_required' | 'unknown';
  }>;
}
export interface ComparisonInput {
  offers: Offer[];
  baselineId: string | null;
  evaluatedAt: string;
  departureDate: string | null;
  returnDate: string | null;
  flexDays: number;
  stayNights: number | null;
  allowedAirports: string[];
  maxGroundKm: number | null;
  maxGroundMinutes: number | null;
  budgetMinor: number | null;
  budgetCurrency: string | null;
  maxConnections: number | null;
  maxDurationMinutes: number | null;
  separateTicketsAllowed: boolean;
  airportChangeAllowed: boolean;
  overnightAllowed: boolean;
}
export interface PromotionInput {
  comparison: ComparisonInput;
  promotions: Array<{
    id: string;
    offerId: string;
    baselineId: string;
    eligibility: 'confirmed' | 'declared' | 'unknown' | 'ineligible';
    purchaseFrom: string;
    purchaseUntil: string;
    conditions: string;
    application: 'announced' | 'terms_checked' | 'observed';
    source: Source;
  }>;
}
export interface FareScenarioInput {
  options: Array<{
    id: string;
    currency: string;
    normalMinor: number | null;
    changeFeeMinor: number | null;
    issuerFeeMinor: number | null;
    fareDifferenceMinor: number | null;
    taxDifferenceMinor: number | null;
    reboughtServicesMinor: number | null;
    refundCashMinor: number | null;
    recoverableTaxesMinor: number | null;
    retainedMinor: number | null;
    creditMinor: number | null;
    creditConditions: string | null;
    scenarioAt: string;
    initiative: 'traveler' | 'supplier' | 'unknown';
    rulesIncorporatedAtPurchase: boolean | null;
    source: Source;
  }>;
}
export interface NegotiationInput {
  recipient: string;
  goal: string;
  language: string;
  channel: 'message' | 'email' | 'form';
  comparison: ComparisonInput | null;
  constraints: string[];
}
export interface HiddenCityInput {
  standard: Offer;
  alternative: Offer;
  realDestination: string;
  contractedStops: string[];
  evaluatedAt: string;
  conditions: Array<{
    topic:
      'baggage' | 'remaining_segments' | 'repricing' | 'loyalty' | 'operational_change' | 'entry';
    condition: string;
    source: Source | null;
  }>;
}
export interface GroupInput {
  currency: string;
  households: Array<{
    id: string;
    participants: string[];
    ceilingMinor: number | null;
    cashLimitMinor: number | null;
  }>;
  scenarios: Array<{
    id: string;
    destination: string;
    model: 'package' | 'collective' | 'hybrid';
    scope: string;
    nights: number;
    constraintsConfirmed: boolean | null;
    capacityConfirmed: boolean | null;
    validUntil: string | null;
    costs: Array<{
      id: string;
      label: string;
      lowMinor: number | null;
      highMinor: number | null;
      source: Source | null;
      acceptedRule: boolean;
      shares: Array<{ householdId: string; weight: number }>;
    }>;
    cashFlows: Array<{
      id: string;
      householdId: string;
      at: string;
      amountMinor: number;
      kind: 'payment' | 'refund' | 'deposit' | 'deposit_return' | 'card_hold' | 'card_release';
    }>;
  }>;
  evaluatedAt: string;
}
export type PlanningInput =
  | ComparisonInput
  | PromotionInput
  | FareScenarioInput
  | NegotiationInput
  | HiddenCityInput
  | GroupInput;

const text = (maxLength = 600) => ({ type: 'string', minLength: 1, maxLength });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const money = nullable({ type: 'integer', minimum: 0, maximum: 9000000000000 });
const time = { type: 'string', format: 'date-time' };
const date = { type: 'string', format: 'date' };
const number = nullable({ type: 'number', minimum: 0, maximum: 1000000 });
const integer = nullable({ type: 'integer', minimum: 0, maximum: 1000000 });
const bool = { type: 'boolean' };
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const list = (items: object, maxItems = 100, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
});
const object = (properties: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const values = (...items: string[]) => ({ enum: items });
const source = object({
  id: text(80),
  url: nullable({ type: 'string', format: 'uri', pattern: '^https://' }),
  observedAt: time,
  status: values('observed', 'indicative', 'historical', 'declared'),
  note: text(1000),
});
const offer = object({
  id: text(80),
  seller: text(200),
  operator: text(200),
  origin: text(120),
  destination: text(120),
  departure: time,
  arrival: time,
  returnDeparture: nullable(time),
  destinationArrivalDate: date,
  destinationDepartureDate: nullable(date),
  passengers: text(300),
  cabin: text(80),
  baggage: text(200),
  requiredServices: text(400),
  paymentCategory: text(100),
  capacityConfirmed: nullable(bool),
  validUntil: nullable(time),
  sources: list(source, 30, 1),
  costs: list(
    object({
      id: text(80),
      label: text(200),
      unit: text(80),
      quantity: { type: 'integer', minimum: 1, maximum: 100000 },
      unitMinor: money,
      currency,
      treatment: values('included', 'necessary', 'optional', 'conditional'),
      selected: bool,
      sourceIds: list(text(80), 30),
    }),
    100,
    1,
  ),
  airport: text(120),
  groundDistanceKm: number,
  groundMinutes: integer,
  overnight: bool,
  ticketStructure: values('single', 'separate', 'unknown'),
  connectionProtectionSourceId: nullable(text(80)),
  connections: list(
    object({
      arrival: time,
      departure: time,
      minimumMinutes: integer,
      basis: nullable(text()),
      sourceId: nullable(text(80)),
      airportChange: bool,
      baggageRecheck: nullable(bool),
      entryPermission: values('confirmed', 'not_required', 'unknown'),
    }),
    10,
  ),
});
const comparison = object({
  offers: list(offer, 30, 1),
  baselineId: nullable(text(80)),
  evaluatedAt: time,
  departureDate: nullable(date),
  returnDate: nullable(date),
  flexDays: { type: 'integer', minimum: 0, maximum: 31 },
  stayNights: integer,
  allowedAirports: list(text(120), 30),
  maxGroundKm: number,
  maxGroundMinutes: integer,
  budgetMinor: money,
  budgetCurrency: nullable(currency),
  maxConnections: integer,
  maxDurationMinutes: integer,
  separateTicketsAllowed: bool,
  airportChangeAllowed: bool,
  overnightAllowed: bool,
});
export const planningSchemas: Record<ToolId, object> = {
  'flex-dates': comparison,
  airports: comparison,
  connections: comparison,
  'total-cost': comparison,
  promotions: object({
    comparison,
    promotions: list(
      object({
        id: text(80),
        offerId: text(80),
        baselineId: text(80),
        eligibility: values('confirmed', 'declared', 'unknown', 'ineligible'),
        purchaseFrom: time,
        purchaseUntil: time,
        conditions: text(2000),
        application: values('announced', 'terms_checked', 'observed'),
        source,
      }),
      30,
    ),
  }),
  'fare-scenarios': object({
    options: list(
      object({
        id: text(80),
        currency,
        normalMinor: money,
        changeFeeMinor: money,
        issuerFeeMinor: money,
        fareDifferenceMinor: money,
        taxDifferenceMinor: nullable({
          type: 'integer',
          minimum: -9000000000000,
          maximum: 9000000000000,
        }),
        reboughtServicesMinor: money,
        refundCashMinor: money,
        recoverableTaxesMinor: money,
        retainedMinor: money,
        creditMinor: money,
        creditConditions: nullable(text(1500)),
        scenarioAt: time,
        initiative: values('traveler', 'supplier', 'unknown'),
        rulesIncorporatedAtPurchase: nullable(bool),
        source,
      }),
      20,
      1,
    ),
  }),
  negotiation: object({
    recipient: text(200),
    goal: text(400),
    language: localeSchema,
    channel: values('message', 'email', 'form'),
    comparison: nullable(comparison),
    constraints: list(text(200), 15),
  }),
  'hidden-city': object({
    standard: offer,
    alternative: offer,
    realDestination: text(120),
    contractedStops: list(text(120), 20, 3),
    evaluatedAt: time,
    conditions: list(
      object({
        topic: values(
          'baggage',
          'remaining_segments',
          'repricing',
          'loyalty',
          'operational_change',
          'entry',
        ),
        condition: text(1500),
        source: nullable(source),
      }),
      6,
    ),
  }),
  'group-split': object({
    currency,
    households: list(
      object({
        id: { type: 'string', pattern: '^N[0-9]{2,4}$' },
        participants: {
          ...list({ type: 'string', pattern: '^P[0-9]{2,4}$' }, 100, 1),
          uniqueItems: true,
        },
        ceilingMinor: money,
        cashLimitMinor: money,
      }),
      30,
      1,
    ),
    scenarios: list(
      object({
        id: text(80),
        destination: text(150),
        model: values('package', 'collective', 'hybrid'),
        scope: text(500),
        nights: { type: 'integer', minimum: 0, maximum: 365 },
        constraintsConfirmed: nullable(bool),
        capacityConfirmed: nullable(bool),
        validUntil: nullable(time),
        costs: list(
          object({
            id: text(80),
            label: text(200),
            lowMinor: money,
            highMinor: money,
            source: nullable(source),
            acceptedRule: bool,
            shares: list(
              object({
                householdId: text(80),
                weight: { type: 'integer', minimum: 1, maximum: 1000000 },
              }),
              30,
              1,
            ),
          }),
          100,
          1,
        ),
        cashFlows: list(
          object({
            id: text(80),
            householdId: text(80),
            at: time,
            amountMinor: { type: 'integer', minimum: 0, maximum: 9000000000000 },
            kind: values(
              'payment',
              'refund',
              'deposit',
              'deposit_return',
              'card_hold',
              'card_release',
            ),
          }),
          300,
        ),
      }),
      9,
      1,
    ),
    evaluatedAt: time,
  }),
};
