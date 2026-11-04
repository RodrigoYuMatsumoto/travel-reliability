export const packageProviderIds = ['atrativa', 'niel', 'viajantes-do-valle', 'augustus'] as const;
export type PackageProviderId = (typeof packageProviderIds)[number];

const location = {
  type: 'string',
  minLength: 1,
  maxLength: 100,
  pattern: '^[^0-9@<>\\x00-\\x1f\\x7f]+$',
};
export const packageDiscoverySchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://travel-reliability.example/schema/package-discovery.json',
  title: 'Bounded offline package discovery plan',
  type: 'object',
  additionalProperties: false,
  required: ['origin', 'windows', 'destination'],
  properties: {
    origin: location,
    destination: { anyOf: [location, { type: 'null' }] },
    windows: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'startDate', 'endDate'],
        properties: {
          id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
        },
      },
    },
    providerIds: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { enum: packageProviderIds },
    },
    cursor: { type: 'integer', minimum: 0, maximum: 1000 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  },
} as const;

export interface PackageDiscoveryInput {
  origin: string;
  destination: string | null;
  windows: Array<{ id: string; startDate: string; endDate: string }>;
  providerIds?: PackageProviderId[];
  cursor?: number;
  limit?: number;
}
