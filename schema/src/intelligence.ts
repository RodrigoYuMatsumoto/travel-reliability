/** Additive, passive-data contracts. No remote references or executable plugins. */
export const intelligenceToolIds = ['loyalty-arbitrage', 'multimodal-stitching'] as const;
export const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
export const nullableInteger = { anyOf: [integer, { type: 'null' }] };
export const identifier = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$' };
export const timestamp = { type: 'string', format: 'date-time' };
export const boundedText = { type: 'string', maxLength: 600 };
export const ids = { type: 'array', items: identifier, uniqueItems: true, maxItems: 40 };
export const strictObject = (
  properties: Record<string, unknown>,
  required = Object.keys(properties),
) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
const root = (properties: Record<string, unknown>, required?: string[]) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  ...strictObject(properties, required),
});
export const evidenceReferenceSchema = strictObject({
  id: identifier,
  sourceUrl: { type: 'string', format: 'uri', maxLength: 2048, pattern: '^https://' },
  sourceSha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  retrievedAt: timestamp,
  reviewAfter: timestamp,
  state: { enum: ['operator_asserted', 'source_captured', 'reviewed', 'conflicting'] },
  sourceSpan: strictObject({
    quote: { type: 'string', minLength: 1, maxLength: 180 },
    locator: boundedText,
  }),
  assertion: strictObject({ subject: identifier, predicate: identifier, value: {} }),
});
export const claimOutputSchema = root({
  evaluatedAt: timestamp,
  claims: {
    type: 'array',
    maxItems: 100,
    items: strictObject({
      id: identifier,
      subject: identifier,
      predicate: identifier,
      value: {},
      kind: { enum: ['fact', 'calculation', 'guidance', 'hypothesis'] },
      evidenceRefs: ids,
      calculationRef: { anyOf: [identifier, { type: 'null' }] },
    }),
  },
});
export const ratioSchema = strictObject({
  sourceUnits: { ...integer, minimum: 1 },
  targetUnits: { ...integer, minimum: 1 },
});
const edgeSchema = strictObject({
  id: identifier,
  source_program: identifier,
  target_program: identifier,
  edge_type: {
    enum: ['DIRECT_TRANSFER', 'AVIOS_POOL_LINK', 'VOUCHER_EXCHANGE', 'CASH_PLUS_POINTS'],
  },
  verification_state: { enum: ['operator_asserted', 'source_captured', 'reviewed', 'conflicting'] },
  base_ratio: { anyOf: [ratioSchema, { type: 'null' }] },
  club_tier_ratio: { anyOf: [ratioSchema, { type: 'null' }] },
  min_transfer_points: nullableInteger,
  max_transfer_points: nullableInteger,
  transfer_multiple: nullableInteger,
  max_target_units: nullableInteger,
  eligibility_constraint: ids,
  transfer_bonus_bps: { ...integer, maximum: 30000 },
  settlement_business_days: nullableInteger,
  settlement_calendar: { anyOf: [identifier, { type: 'null' }] },
  supports_cart_topup: { type: ['boolean', 'null'] },
  last_verified_date: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  evidenceRefs: ids,
});
export const loyaltyGraphSchema = root({
  format: { const: 'travel-reliability-loyalty-graph/1' },
  version: identifier,
  synthetic: { type: 'boolean' },
  programs: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: identifier },
  edges: { type: 'array', maxItems: 300, items: edgeSchema },
  evidence: { type: 'array', maxItems: 500, items: evidenceReferenceSchema },
});
export const loyaltyArbitrageSchema = root({
  evaluatedAt: timestamp,
  sourceProgram: identifier,
  targetProgram: identifier,
  sourcePoints: { ...integer, maximum: 1_000_000_000 },
  acquisitionCostPer1000Minor: { anyOf: [{ ...integer, minimum: 1 }, { type: 'null' }] },
  topUp: {
    anyOf: [
      strictObject({ points: { ...integer, minimum: 1 }, cashMinor: integer }),
      { type: 'null' },
    ],
  },
  eligibility: {
    type: 'array',
    maxItems: 40,
    items: strictObject({ code: identifier, value: { enum: ['yes', 'no', 'unknown'] } }),
  },
  requiredAwardPoints: { anyOf: [{ ...integer, minimum: 1 }, { type: 'null' }] },
  awardTaxesMinor: nullableInteger,
  cashFareMinor: nullableInteger,
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  comparableBaggage: { type: ['boolean', 'null'] },
  comparableCancellation: { type: ['boolean', 'null'] },
  awardAvailable: { type: ['boolean', 'null'] },
  pointsValidThroughTravel: { type: ['boolean', 'null'] },
  maxHops: { type: 'integer', minimum: 1, maximum: 5 },
  maxExpansions: { type: 'integer', minimum: 1, maximum: 2000 },
  maxResults: { type: 'integer', minimum: 1, maximum: 20 },
});
const localTime = strictObject({
  local: { type: 'string', maxLength: 40 },
  timeZone: { type: 'string', maxLength: 100 },
});
const sourceSchema = strictObject({
  id: identifier,
  observedAt: timestamp,
  evidenceRef: { anyOf: [identifier, { type: 'null' }] },
});
const legSchema = strictObject({
  id: identifier,
  origin: identifier,
  destination: identifier,
  mode: { enum: ['flight', 'bus', 'rail', 'transfer', 'ferry'] },
  departure: localTime,
  arrival: localTime,
  currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  costMinor: nullableInteger,
  bookingGroup: { anyOf: [identifier, { type: 'null' }] },
  baggageThrough: { type: ['boolean', 'null'] },
  positioning: { type: 'boolean' },
  hiddenCity: { type: 'boolean' },
  sourceRefs: ids,
});
export const multimodalStitchingSchema = root({
  evaluatedAt: timestamp,
  origin: identifier,
  destination: identifier,
  nodes: {
    type: 'array',
    minItems: 2,
    maxItems: 100,
    items: strictObject({
      id: identifier,
      minimumConnectionMinutes: nullableInteger,
      timeZone: { type: ['string', 'null'], maxLength: 100 },
      country: { type: ['string', 'null'], pattern: '^[A-Z]{2}$' },
    }),
  },
  legs: { type: 'array', maxItems: 500, items: legSchema },
  sources: { type: 'array', maxItems: 500, items: sourceSchema },
  separateTicketBufferMinutes: nullableInteger,
  baggageBufferMinutes: nullableInteger,
  maxHops: { type: 'integer', minimum: 1, maximum: 8 },
  maxExpansions: { type: 'integer', minimum: 1, maximum: 3000 },
  maxResults: { type: 'integer', minimum: 1, maximum: 20 },
});
const territorialScope = strictObject({
  country: { type: 'string', pattern: '^[A-Z]{2}$' },
  subdivision: { type: ['string', 'null'], maxLength: 80 },
  municipality: { type: ['string', 'null'], maxLength: 80 },
});
const packClaim = strictObject({
  id: identifier,
  key: identifier,
  statement: boundedText,
  context: boundedText,
  value: {},
  kind: { enum: ['fact', 'guidance'] },
  evidenceRefs: ids,
  validFrom: timestamp,
  validTo: timestamp,
  personas: {
    type: 'array',
    minItems: 1,
    maxItems: 4,
    uniqueItems: true,
    items: { enum: ['solo', 'family', 'tourism', 'business_corporate'] },
  },
});
const claimsSchema = { type: 'array', maxItems: 100, items: packClaim };
const basePack = {
  format: { const: 'travel-reliability-country-pack/1' },
  version: identifier,
  scope: territorialScope,
  synthetic: { type: 'boolean' },
  evidence: { type: 'array', maxItems: 200, items: evidenceReferenceSchema },
};
export const localEcosystemSchema = root({
  ...basePack,
  mobility_apps: claimsSchema,
  food_and_delivery_apps: claimsSchema,
  payment_and_connectivity: claimsSchema,
  safety_and_sanitary: claimsSchema,
});
export const culturalProtocolSchema = root({
  ...basePack,
  persona: { enum: ['solo', 'family', 'tourism', 'business_corporate'] },
  communication_matrix: claimsSchema,
  negotiation_and_hierarchy: claimsSchema,
  rapport_and_taboos: claimsSchema,
  corporate_gifting_and_dining: claimsSchema,
});
export const countryPackQuerySchema = root({
  evaluatedAt: timestamp,
  scope: territorialScope,
  persona: { enum: ['solo', 'family', 'tourism', 'business_corporate'] },
  packs: {
    type: 'array',
    maxItems: 20,
    items: { anyOf: [localEcosystemSchema, culturalProtocolSchema] },
  },
});
