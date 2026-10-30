import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AppError } from './errors.js';
const text = (maxLength = 4000) => ({ type: 'string', maxLength });
const nullableText = (maxLength = 4000) => ({ type: ['string', 'null'], maxLength });
const choices = (...values: string[]) => ({ enum: values });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const money = { type: ['integer', 'null'], minimum: 0, maximum: 9000000000000 };
export const inputSchemas = {
  event: object({
    serviceId: text(80),
    kind: choices(
      'delay',
      'cancellation',
      'denied_boarding',
      'baggage_issue',
      'lodging_issue',
      'refund_requested',
      'refund_received',
    ),
    occurredAt: { type: 'string', format: 'date-time' },
    waitingMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 43200 },
    overnight: { type: 'boolean' },
    specialAssistance: { type: 'boolean' },
    providerResponsibility: choices('yes', 'no', 'unknown'),
    description: text(),
    documentIds: {
      type: 'array',
      maxItems: 50,
      uniqueItems: true,
      items: { type: 'string', format: 'uuid' },
    },
    amountMinor: money,
    currency: { type: ['string', 'null'], pattern: '^[A-Z]{3}$' },
    phase: choices('departure', 'in_transit', 'arrival', 'unknown'),
    refundChoice: choices('continue', 'refund', 'unknown'),
    residentAtOrigin: { type: ['boolean', 'null'] },
    exceptionalConditions: choices('none', 'active', 'unknown'),
  }),
  review: object(
    {
      tripId: { type: 'string', format: 'uuid' },
      serviceId: text(80),
      evidenceDocumentId: { type: 'string', format: 'uuid' },
      comparisons: {
        type: 'array',
        maxItems: 12,
        items: object({
          attribute: choices(
            'cleanliness',
            'accessibility',
            'internet',
            'noise',
            'beds',
            'check_in',
            'other',
          ),
          advertised: nullableText(300),
          observed: nullableText(300),
        }),
      },
      ratings: object(
        Object.fromEntries(
          ['cleanliness', 'accessibility', 'accuracy', 'service', 'resolution'].map((key) => [
            key,
            { type: ['integer', 'null'], minimum: 1, maximum: 5 },
          ]),
        ),
      ),
      text: text(2000),
    },
    ['tripId', 'serviceId', 'evidenceDocumentId', 'ratings', 'text'],
  ),
  moderation: object({
    status: choices('approved', 'rejected', 'private'),
    confirmNoPersonalData: { const: true },
  }),
  route: object({
    title: text(160),
    country: { type: 'string', pattern: '^[A-Z]{2}$' },
    segments: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: object({
        label: text(200),
        mode: choices('walk', 'car', 'bus', 'flight', 'rail', 'boat'),
        durationMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 43200 },
        distanceKm: { type: ['number', 'null'], minimum: 0, maximum: 100000 },
        costMinor: money,
        currency: { type: ['string', 'null'], pattern: '^[A-Z]{3}$' },
        accessibility: choices('unknown', 'step_free', 'barriers'),
        supportPoints: { type: 'array', maxItems: 40, items: text(200) },
      }),
    },
    seasonality: text(1000),
    safetyNotes: text(1000),
    alternative: text(1000),
    provenance: {
      type: 'array',
      minItems: 1,
      maxItems: 30,
      items: object({
        url: { type: 'string', format: 'uri', pattern: '^https://' },
        license: text(160),
        checkedAt: { type: 'string', format: 'date-time' },
        claim: text(500),
      }),
    },
  }),
  apply: object({
    serviceId: text(80),
    fieldIndexes: {
      type: 'array',
      maxItems: 30,
      uniqueItems: true,
      items: { type: 'integer', minimum: 0, maximum: 299 },
    },
    expectedVersion: { type: 'integer', minimum: 1 },
  }),
  member: object({
    userId: { type: 'string', pattern: '^[a-zA-Z0-9-]{1,128}$' },
    role: choices('editor', 'viewer'),
  }),
  retention: object({ expiresAt: { type: ['string', 'null'], format: 'date-time' } }),
  bundle: object({
    passphrase: { type: 'string', minLength: 12, maxLength: 256 },
    request: text(),
  }),
  dossier: object({ request: text() }),
  consent: object({ consent: { const: true } }),
};
const ajv = new Ajv2020({ strict: true, allErrors: true });
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const validators = Object.fromEntries(
  Object.entries(inputSchemas).map(([key, schema]) => [key, ajv.compile(schema)]),
);
export function input<T>(name: keyof typeof inputSchemas, value: unknown): T {
  const check = validators[name]!;
  if (!check(value))
    throw new AppError(
      'INVALID_INPUT',
      422,
      check.errors?.map((e) => ({ path: e.instancePath, keyword: e.keyword })),
    );
  return value as T;
}
