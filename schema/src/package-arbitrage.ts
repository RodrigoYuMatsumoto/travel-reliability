import { identifier, integer, strictObject, timestamp } from './intelligence.js';
import { packageObservationSchema, type PackageObservation } from './package-observation.js';

/**
 * Input of the package-arbitrage calculator ("Regional Package Arbitrage"). The package
 * side is a literal observation produced by the isolated extractor; every unbundled price
 * is supplied by the caller with a source. Unknown amounts stay null. The calculator never
 * converts currencies, estimates prices, confirms availability or applies discounts.
 * Package mandatory fees follow their payment field: in_package is already inside the
 * published price (reported apart, never added), paid_locally is added and reported as
 * local cash, and unknown is not added and keeps the result non-final.
 */
const currency = { type: 'string', pattern: '^[A-Z]{3}$' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const amount = nullable(integer);
const range = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
const sourceIds = { type: 'array', items: identifier, uniqueItems: true, maxItems: 30 };
const list = (items: object, maxItems: number, minItems = 0) => ({
  type: 'array',
  items,
  minItems,
  maxItems,
});

export const packageArbitrageSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...strictObject({
    evaluatedAt: timestamp,
    currency,
    party: strictObject({
      adults: range(1, 100),
      children: range(0, 100),
      childrenPayAdultPrice: { type: ['boolean', 'null'] },
      rooms: range(1, 50),
    }),
    package: packageObservationSchema,
    sources: list(
      strictObject({
        id: identifier,
        url: nullable({ type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 }),
        observedAt: timestamp,
        status: { enum: ['observed', 'indicative', 'declared'] },
      }),
      100,
      1,
    ),
    quotes: strictObject({
      transport: list(
        strictObject({
          id: identifier,
          mode: { enum: ['bus', 'air'] },
          coverage: { enum: ['round_trip', 'outbound', 'return'] },
          unit: { enum: ['person', 'group'] },
          unitMinor: amount,
          currency,
          sourceIds,
          baggageIncluded: { type: ['boolean', 'null'] },
        }),
        30,
      ),
      lodging: list(
        strictObject({
          id: identifier,
          board: { enum: ['breakfast', 'room_only'] },
          unit: { enum: ['room_night', 'room_stay'] },
          unitMinor: amount,
          currency,
          nights: range(0, 60),
          rooms: range(1, 50),
          sourceIds,
        }),
        30,
      ),
      breakfastAddOn: list(
        strictObject({
          id: identifier,
          unit: { enum: ['person_day'] },
          unitMinor: amount,
          currency,
          days: range(0, 60),
          sourceIds,
        }),
        10,
      ),
      extras: list(
        strictObject({
          id: identifier,
          category: { enum: ['transfer', 'tax', 'activity', 'meal', 'other'] },
          unit: { enum: ['person', 'group'] },
          unitMinor: amount,
          quantity: range(1, 1000),
          currency,
          sourceIds,
          mirrorsPackageInclusion: { type: 'boolean' },
        }),
        40,
      ),
    }),
  }),
};

export interface PackageArbitrageSource {
  id: string;
  url: string | null;
  observedAt: string;
  status: 'observed' | 'indicative' | 'declared';
}
export interface TransportQuote {
  id: string;
  mode: 'bus' | 'air';
  coverage: 'round_trip' | 'outbound' | 'return';
  unit: 'person' | 'group';
  unitMinor: number | null;
  currency: string;
  sourceIds: string[];
  baggageIncluded: boolean | null;
}
export interface LodgingQuote {
  id: string;
  board: 'breakfast' | 'room_only';
  unit: 'room_night' | 'room_stay';
  unitMinor: number | null;
  currency: string;
  nights: number;
  rooms: number;
  sourceIds: string[];
}
export interface BreakfastAddOnQuote {
  id: string;
  unit: 'person_day';
  unitMinor: number | null;
  currency: string;
  days: number;
  sourceIds: string[];
}
export interface ExtraQuote {
  id: string;
  category: 'transfer' | 'tax' | 'activity' | 'meal' | 'other';
  unit: 'person' | 'group';
  unitMinor: number | null;
  quantity: number;
  currency: string;
  sourceIds: string[];
  mirrorsPackageInclusion: boolean;
}
export interface PackageArbitrageInput {
  evaluatedAt: string;
  currency: string;
  party: {
    adults: number;
    children: number;
    childrenPayAdultPrice: boolean | null;
    rooms: number;
  };
  package: PackageObservation;
  sources: PackageArbitrageSource[];
  quotes: {
    transport: TransportQuote[];
    lodging: LodgingQuote[];
    breakfastAddOn: BreakfastAddOnQuote[];
    extras: ExtraQuote[];
  };
}
