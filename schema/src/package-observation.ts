import { integer, strictObject, timestamp } from './intelligence.js';

/**
 * Contract between the isolated Python package extractor (ingest/travel_ingest/packages)
 * and the Node.js package-arbitrage calculator. The extractor emits literal observations
 * only: unknown values stay null, and every non-null field should have an evidence quote.
 * Contacts, payment instructions, addresses and traveler data are never part of it.
 */
export const packageObservationVersion = 'package-observation/1' as const;
export const packageSites = ['atrativa', 'niel', 'valle', 'augustus', 'generic'] as const;
export type PackageSite = (typeof packageSites)[number];

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const localDate = nullable({ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' });
const localTime = nullable({ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' });
const moment = strictObject({ date: localDate, time: localTime, yearStated: { type: 'boolean' } });
const shortList = (maxItems: number, maxLength: number) => ({
  type: 'array',
  maxItems,
  items: text(maxLength),
});

export const packageObservationSchema = strictObject({
  schemaVersion: { const: packageObservationVersion },
  source: strictObject({
    url: { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 },
    site: { enum: packageSites },
    observedAt: timestamp,
    retrieval: { enum: ['fixture', 'static_html', 'rendered_dom'] },
    contentSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  }),
  title: nullable(text(300)),
  destination: nullable(text(200)),
  modal: { enum: ['bus', 'air', 'mixed', 'unknown'] },
  departure: moment,
  returnDeparture: moment,
  returnArrival: moment,
  days: nullable({ type: 'integer', minimum: 1, maximum: 60 }),
  nights: nullable({ type: 'integer', minimum: 0, maximum: 60 }),
  lodging: strictObject({
    name: nullable(text(200)),
    nightsIncluded: nullable({ type: 'integer', minimum: 0, maximum: 60 }),
  }),
  breakfast: strictObject({
    status: { enum: ['included', 'excluded', 'partial', 'unknown'] },
    count: nullable({ type: 'integer', minimum: 0, maximum: 120 }),
  }),
  price: strictObject({
    amountMinor: nullable(integer),
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
    basis: { enum: ['per_person', 'per_room', 'per_group', 'unknown'] },
    qualifier: { enum: ['exact', 'from', 'unknown'] },
    installments: nullable(
      strictObject({
        count: { type: 'integer', minimum: 1, maximum: 60 },
        amountMinor: integer,
      }),
    ),
  }),
  mandatoryFees: {
    type: 'array',
    maxItems: 20,
    items: strictObject({
      label: text(120),
      amountMinor: integer,
      basis: { enum: ['per_person', 'per_group', 'unknown'] },
      payment: { enum: ['in_package', 'paid_locally', 'unknown'] },
    }),
  },
  included: shortList(40, 160),
  excluded: shortList(40, 160),
  boardingCities: shortList(20, 80),
  evidence: {
    type: 'array',
    maxItems: 60,
    items: strictObject({ field: text(80), quote: text(240) }),
  },
  warnings: {
    type: 'array',
    uniqueItems: true,
    maxItems: 30,
    items: { type: 'string', pattern: '^[A-Z][A-Z0-9_]{2,63}$' },
  },
});

export interface PackageMoment {
  date: string | null;
  time: string | null;
  yearStated: boolean;
}

export interface PackageObservation {
  schemaVersion: typeof packageObservationVersion;
  source: {
    url: string;
    site: PackageSite;
    observedAt: string;
    retrieval: 'fixture' | 'static_html' | 'rendered_dom';
    contentSha256: string;
  };
  title: string | null;
  destination: string | null;
  modal: 'bus' | 'air' | 'mixed' | 'unknown';
  departure: PackageMoment;
  returnDeparture: PackageMoment;
  returnArrival: PackageMoment;
  days: number | null;
  nights: number | null;
  lodging: { name: string | null; nightsIncluded: number | null };
  breakfast: { status: 'included' | 'excluded' | 'partial' | 'unknown'; count: number | null };
  price: {
    amountMinor: number | null;
    currency: string;
    basis: 'per_person' | 'per_room' | 'per_group' | 'unknown';
    qualifier: 'exact' | 'from' | 'unknown';
    installments: { count: number; amountMinor: number } | null;
  };
  mandatoryFees: {
    label: string;
    amountMinor: number;
    basis: 'per_person' | 'per_group' | 'unknown';
    payment: 'in_package' | 'paid_locally' | 'unknown';
  }[];
  included: string[];
  excluded: string[];
  boardingCities: string[];
  evidence: { field: string; quote: string }[];
  warnings: string[];
}
