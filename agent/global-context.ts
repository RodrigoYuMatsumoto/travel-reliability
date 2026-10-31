import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../api/src/errors.js';
import { canonicalLocale as canonicalHostLocale, localeSchema } from '../schema/src/locale.js';

export const globalModes = [
  'flight',
  'bus',
  'rail',
  'ferry',
  'cruise',
  'car',
  'rental_car',
  'transfer',
  'taxi',
  'rideshare',
  'bicycle',
  'walking',
  'hotel',
  'vacation_rental',
  'hostel',
  'camping',
  'motorhome',
  'activity',
  'meeting',
  'event',
  'other',
] as const;
export const globalResearchTopics = [
  'geography',
  'history',
  'culture',
  'customs',
  'safety',
  'accessibility',
  'entry',
  'health',
  'insurance',
  'business',
  'connectivity',
] as const;
const evidenceTopics = [
  ...globalResearchTopics,
  'supplier_identity',
  'conditions',
  'costs',
  'schedule',
  'baggage',
  'driving',
  'accommodation',
] as const;
const id = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' } as const;
const country = { type: ['string', 'null'], pattern: '^[A-Z]{2}$' } as const;
const instant = {
  type: 'string',
  format: 'date-time',
  maxLength: 35,
  pattern: '(?:Z|[+-][0-9]{2}:[0-9]{2})$',
} as const;
const nullableId = { anyOf: [id, { type: 'null' }] } as const;
const localSchedule = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['localDateTime', 'utcOffset'],
      properties: {
        localDateTime: {
          type: 'string',
          maxLength: 19,
          pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-5][0-9]$',
        },
        utcOffset: {
          type: ['string', 'null'],
          maxLength: 6,
          pattern: '^(?:Z|[+-][0-9]{2}:[0-5][0-9])$',
        },
      },
    },
  ],
} as const;

/** Public, bounded, host-independent documentary input. No raw documents or account credentials. */
export const globalContextSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'tripKey',
    'language',
    'locale',
    'currencies',
    'baseCurrency',
    'unitSystem',
    'purposes',
    'locations',
    'segments',
  ],
  properties: {
    tripKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    language: localeSchema,
    locale: { ...localeSchema, type: ['string', 'null'] },
    currencies: {
      anyOf: [
        { type: 'null' },
        {
          type: 'array',
          maxItems: 8,
          uniqueItems: true,
          items: { type: 'string', pattern: '^[A-Z]{3}$' },
        },
      ],
    },
    baseCurrency: { type: ['string', 'null'], pattern: '^[A-Z]{3}$' },
    unitSystem: { enum: ['metric', 'us', 'uk', null] },
    purposes: {
      anyOf: [
        { type: 'null' },
        {
          type: 'array',
          maxItems: 6,
          uniqueItems: true,
          items: {
            enum: [
              'leisure',
              'business',
              'hybrid',
              'education',
              'medical',
              'pilgrimage',
              'event',
              'family',
              'volunteer',
              'relocation',
              'adventure',
              'other',
            ],
          },
        },
      ],
    },
    locations: {
      type: 'array',
      minItems: 1,
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'countryCode', 'administrativeArea', 'municipalityKey', 'timeZone'],
        properties: {
          id,
          countryCode: country,
          administrativeArea: {
            type: ['string', 'null'],
            maxLength: 6,
            pattern: '^[A-Z]{2}-[A-Z0-9]{1,3}$',
          },
          municipalityKey: { anyOf: [id, { type: 'null' }] },
          timeZone: {
            type: ['string', 'null'],
            minLength: 3,
            maxLength: 80,
            pattern: '^(?:UTC|[A-Za-z_+-]+(?:/[A-Za-z0-9_+.-]+){1,2})$',
          },
        },
      },
    },
    segments: {
      type: 'array',
      maxItems: 64,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'mode', 'from', 'to', 'departure', 'arrival', 'minimumConnectionMinutes'],
        properties: {
          id,
          mode: { enum: globalModes },
          from: nullableId,
          to: nullableId,
          departure: localSchedule,
          arrival: localSchedule,
          minimumConnectionMinutes: { type: ['integer', 'null'], minimum: 0, maximum: 10080 },
        },
      },
    },
    researchTopics: {
      type: 'array',
      maxItems: globalResearchTopics.length,
      uniqueItems: true,
      items: { enum: globalResearchTopics },
    },
    evidence: {
      type: 'array',
      maxItems: 128,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'sourceRef',
          'topic',
          'countryCode',
          'locationId',
          'segmentId',
          'observedAt',
          'validUntil',
        ],
        properties: {
          id,
          sourceRef: { type: 'string', pattern: '^SRC[0-9]{2,6}$' },
          topic: { enum: evidenceTopics },
          countryCode: country,
          locationId: nullableId,
          segmentId: nullableId,
          observedAt: instant,
          validUntil: { anyOf: [instant, { type: 'null' }] },
        },
      },
    },
  },
} as const;

type Mode = (typeof globalModes)[number];
type Topic = (typeof evidenceTopics)[number];
interface Location {
  id: string;
  countryCode: string | null;
  administrativeArea: string | null;
  municipalityKey: string | null;
  timeZone: string | null;
}
interface Schedule {
  localDateTime: string;
  utcOffset: string | null;
}
interface Segment {
  id: string;
  mode: Mode;
  from: string | null;
  to: string | null;
  departure: Schedule | null;
  arrival: Schedule | null;
  minimumConnectionMinutes: number | null;
}
interface Evidence {
  id: string;
  sourceRef: string;
  topic: Topic;
  countryCode: string | null;
  locationId: string | null;
  segmentId: string | null;
  observedAt: string;
  validUntil: string | null;
}
export interface GlobalContextInput {
  tripKey: string;
  language: string;
  locale: string | null;
  currencies: string[] | null;
  baseCurrency: string | null;
  unitSystem: 'metric' | 'us' | 'uk' | null;
  purposes: string[] | null;
  locations: Location[];
  segments: Segment[];
  researchTopics?: (typeof globalResearchTopics)[number][];
  evidence?: Evidence[];
}
type Scale = 'international' | 'national' | 'state' | 'intermunicipal' | 'local' | 'unknown';
type ScheduleStatus =
  | 'resolved'
  | 'not_supplied'
  | 'missing_time_zone'
  | 'ambiguous_local_time'
  | 'nonexistent_local_time'
  | 'offset_mismatch';
interface ResolvedSchedule {
  status: ScheduleStatus;
  localDateTime: string | null;
  timeZone: string | null;
  utcOffset: string | null;
  instant: string | null;
  candidateOffsets: string[];
}

const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true });
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const validate = ajv.compile(globalContextSchema);
const supportedCurrencies = new Set(Intl.supportedValuesOf('currency'));
function reject(code = 'INVALID_GLOBAL_CONTEXT_INPUT'): never {
  throw new AppError(code, 422);
}

/** Validate descriptors before Ajv reads values; inherited properties/getters never carry authority. */
function assertJson(input: unknown) {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 6000 || depth > 8) reject();
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 100) reject();
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) reject();
      continue;
    }
    if (typeof value !== 'object') reject();
    const proto = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(value)) {
      if (proto !== Array.prototype || value.length > 128 || keys.length !== value.length + 1)
        reject();
      for (let index = 0; index < value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) reject();
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    } else {
      if ((proto !== Object.prototype && proto !== null) || keys.length > 14) reject();
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key))
          reject();
        const descriptor = descriptors[key]!;
        if (!('value' in descriptor) || !descriptor.enumerable) reject();
        stack.push({ value: descriptor.value, depth: depth + 1 });
      }
    }
  }
}

const euCountries =
  'AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' ');
const sources = [
  {
    id: 'us-air-consumer',
    countryCodes: ['US'],
    url: 'https://www.transportation.gov/airconsumer',
    topics: ['conditions', 'accessibility', 'baggage'],
  },
  {
    id: 'uk-air-passengers',
    countryCodes: ['GB'],
    url: 'https://www.caa.co.uk/air-passengers/',
    topics: ['conditions', 'accessibility', 'baggage'],
  },
  {
    id: 'eu-travel',
    countryCodes: euCountries,
    url: 'https://europa.eu/youreurope/citizens/travel/index_en.htm',
    topics: ['conditions', 'entry', 'driving', 'accessibility'],
  },
  {
    id: 'ca-air-consumer',
    countryCodes: ['CA'],
    url: 'https://otc-cta.gc.ca/eng/air-passenger-protection-regulations-highlights',
    topics: ['conditions', 'accessibility', 'baggage'],
  },
] as const;

/** Source-discovery plugins only: selecting one never establishes a rule's applicability. */
export const jurisdictionSourcePlugins = Object.freeze(
  sources.map((source) =>
    Object.freeze({
      ...source,
      countryCodes: Object.freeze([...source.countryCodes]),
      topics: Object.freeze([...source.topics]),
      version: '1',
      linkCheckedAt: '2026-10-31',
      coverage: 'source_discovery_only' as const,
      applicability: 'not_evaluated' as const,
      executableLegalRules: 0,
    }),
  ),
);

function canonicalLocale(value: string): string {
  const canonical = canonicalHostLocale(value);
  return canonical ?? reject('GLOBAL_LANGUAGE_OR_LOCALE_UNSUPPORTED');
}
function timeZone(value: string): string {
  try {
    return new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return reject('GLOBAL_TIME_ZONE_UNSUPPORTED');
  }
}
function money(code: string) {
  if (!supportedCurrencies.has(code)) reject('GLOBAL_CURRENCY_UNSUPPORTED');
  const digits = new Intl.NumberFormat('en', {
    style: 'currency',
    currency: code,
  }).resolvedOptions().maximumFractionDigits;
  return { code, minorUnitDigits: digits, metadataSource: 'runtime_intl_currency_data' as const };
}
function scale(from: Location | undefined, to: Location | undefined): Scale {
  if (!from?.countryCode || !to?.countryCode) return 'unknown';
  if (from.countryCode !== to.countryCode) return 'international';
  if (!from.administrativeArea || !to.administrativeArea) return 'national';
  if (from.administrativeArea !== to.administrativeArea) return 'national';
  if (!from.municipalityKey || !to.municipalityKey) return 'state';
  return from.municipalityKey === to.municipalityKey ? 'local' : 'intermunicipal';
}

function resolveSchedule(schedule: Schedule | null, zone: string | null): ResolvedSchedule {
  const result: ResolvedSchedule = {
    status: schedule ? 'missing_time_zone' : 'not_supplied',
    localDateTime: schedule?.localDateTime ?? null,
    timeZone: zone,
    utcOffset: null,
    instant: null,
    candidateOffsets: [],
  };
  if (!schedule) return result;
  let civil: Temporal.PlainDateTime;
  try {
    civil = Temporal.PlainDateTime.from(schedule.localDateTime, { overflow: 'reject' });
  } catch {
    return reject('GLOBAL_LOCAL_DATE_TIME_INVALID');
  }
  if (!zone) return result;
  const early = civil.toZonedDateTime(zone, { disambiguation: 'earlier' });
  const late = civil.toZonedDateTime(zone, { disambiguation: 'later' });
  const candidates = [early, late].filter(
    (candidate, index, all) =>
      candidate.toPlainDateTime().equals(civil) &&
      all.findIndex((row) => row.epochNanoseconds === candidate.epochNanoseconds) === index,
  );
  if (!candidates.length) return { ...result, status: 'nonexistent_local_time' };
  const requested = schedule.utcOffset === 'Z' ? '+00:00' : schedule.utcOffset;
  const selected =
    requested === null
      ? candidates.length === 1
        ? candidates[0]
        : undefined
      : candidates.find((candidate) => candidate.offset === requested);
  if (!selected)
    return {
      ...result,
      status: requested === null ? 'ambiguous_local_time' : 'offset_mismatch',
      candidateOffsets: candidates.map((candidate) => candidate.offset),
    };
  return {
    ...result,
    status: 'resolved',
    utcOffset: selected.offset,
    instant: selected.toInstant().toString(),
  };
}

const movingModes = new Set<Mode>([
  'flight',
  'bus',
  'rail',
  'ferry',
  'cruise',
  'car',
  'rental_car',
  'transfer',
  'taxi',
  'rideshare',
  'bicycle',
  'walking',
  'motorhome',
]);
const lodgingModes = new Set<Mode>(['hotel', 'vacation_rental', 'hostel', 'camping', 'motorhome']);
function requiredTopics(mode: Mode): Topic[] {
  const topics: Topic[] = ['supplier_identity', 'conditions', 'costs', 'schedule', 'accessibility'];
  if (['flight', 'bus', 'rail', 'ferry', 'cruise'].includes(mode)) topics.push('baggage');
  if (['car', 'rental_car', 'motorhome'].includes(mode)) topics.push('driving', 'insurance');
  if (lodgingModes.has(mode)) topics.push('accommodation');
  return topics;
}
function parseInstant(value: string): number {
  try {
    return Temporal.Instant.from(value).epochMilliseconds;
  } catch {
    return reject('GLOBAL_EVIDENCE_TIME_INVALID');
  }
}

/**
 * Build a global, multimodal documentary context from declared data. No default
 * country/nationality, currency conversion, geocoding, provider search, LLM call,
 * storage, document verification, permission grant or legal decision is performed.
 * `now` is a trusted clock argument; source times in input cannot override it.
 */
export function prepareGlobalContext(input: unknown, now = Date.now()) {
  assertJson(input);
  if (!validate(input)) reject();
  if (!Number.isSafeInteger(now) || now < 0 || now > 8640000000000000)
    reject('GLOBAL_CLOCK_UNAVAILABLE');
  const supplied = input as GlobalContextInput;
  const language = canonicalLocale(supplied.language);
  const locale = supplied.locale === null ? null : canonicalLocale(supplied.locale);
  const currencies = supplied.currencies?.map(money) ?? null;
  if (supplied.baseCurrency) {
    money(supplied.baseCurrency);
    if (!supplied.currencies?.includes(supplied.baseCurrency))
      reject('GLOBAL_BASE_CURRENCY_NOT_DECLARED');
  }
  const locations = new Map<string, Location>();
  const municipalities = new Map<string, string | null>();
  for (const location of supplied.locations) {
    if (locations.has(location.id)) reject('GLOBAL_DUPLICATE_LOCATION');
    if (
      location.administrativeArea &&
      (!location.countryCode || !location.administrativeArea.startsWith(location.countryCode + '-'))
    )
      reject('GLOBAL_GEOGRAPHY_CONFLICT');
    if (location.municipalityKey && location.countryCode && location.administrativeArea) {
      const key = `${location.countryCode}/${location.municipalityKey}`;
      if (municipalities.has(key) && municipalities.get(key) !== location.administrativeArea)
        reject('GLOBAL_GEOGRAPHY_CONFLICT');
      municipalities.set(key, location.administrativeArea);
    }
    locations.set(location.id, {
      ...location,
      timeZone: location.timeZone ? timeZone(location.timeZone) : null,
    });
  }
  const segmentIds = new Set<string>();
  const issues: { segmentId: string | null; field: string; code: string }[] = [];
  const segments = supplied.segments.map((segment) => {
    if (segmentIds.has(segment.id)) reject('GLOBAL_DUPLICATE_SEGMENT');
    segmentIds.add(segment.id);
    if (
      (segment.from && !locations.has(segment.from)) ||
      (segment.to && !locations.has(segment.to))
    )
      reject('GLOBAL_LOCATION_REFERENCE_UNKNOWN');
    const from = segment.from ? locations.get(segment.from) : undefined;
    const to = segment.to ? locations.get(segment.to) : undefined;
    const departure = resolveSchedule(segment.departure, from?.timeZone ?? null);
    const arrival = resolveSchedule(segment.arrival, to?.timeZone ?? null);
    for (const [field, resolved] of [
      ['departure', departure],
      ['arrival', arrival],
    ] as const) {
      if (resolved.status !== 'resolved')
        issues.push({ segmentId: segment.id, field, code: resolved.status });
    }
    const elapsedMinutes =
      departure.instant && arrival.instant
        ? (parseInstant(arrival.instant) - parseInstant(departure.instant)) / 60000
        : null;
    if (elapsedMinutes !== null && elapsedMinutes < 0)
      issues.push({ segmentId: segment.id, field: 'schedule', code: 'arrival_before_departure' });
    const countries = [
      ...new Set([from?.countryCode, to?.countryCode].filter((value): value is string => !!value)),
    ].sort();
    if (!from?.countryCode || !to?.countryCode)
      issues.push({ segmentId: segment.id, field: 'countryCode', code: 'geography_incomplete' });
    return {
      id: segment.id,
      mode: segment.mode,
      from: segment.from,
      to: segment.to,
      scale: scale(from, to),
      countryCodes: countries,
      departure,
      arrival,
      elapsedMinutes,
      moving: movingModes.has(segment.mode),
    };
  });
  const evidence = supplied.evidence ?? [];
  const evidenceIds = new Set<string>();
  const observations = evidence.map((item) => {
    if (evidenceIds.has(item.id)) reject('GLOBAL_DUPLICATE_EVIDENCE');
    evidenceIds.add(item.id);
    if (
      (item.locationId && !locations.has(item.locationId)) ||
      (item.segmentId && !segmentIds.has(item.segmentId))
    )
      reject('GLOBAL_EVIDENCE_REFERENCE_UNKNOWN');
    const target = item.locationId ? locations.get(item.locationId)! : null;
    const targetSegment = item.segmentId
      ? segments.find((segment) => segment.id === item.segmentId)!
      : null;
    if (
      item.countryCode &&
      ((target?.countryCode && target.countryCode !== item.countryCode) ||
        (targetSegment && !targetSegment.countryCodes.includes(item.countryCode)))
    )
      reject('GLOBAL_EVIDENCE_GEOGRAPHY_CONFLICT');
    const observedAt = parseInstant(item.observedAt);
    const validUntil = item.validUntil === null ? null : parseInstant(item.validUntil);
    if (validUntil !== null && validUntil < observedAt) reject('GLOBAL_EVIDENCE_VALIDITY_CONFLICT');
    const freshness =
      observedAt > now
        ? 'future_observation'
        : validUntil === null
          ? 'validity_unknown'
          : validUntil <= now
            ? 'expired'
            : 'caller_reported_current';
    return { ...item, freshness, independentlyVerified: false as const };
  });
  const checklist: {
    targetType: 'segment' | 'location';
    targetId: string;
    topic: Topic;
    status: 'missing_reference' | 'needs_fresh_verification' | 'reference_supplied_not_verified';
    sourceRefs: string[];
  }[] = [];
  function addCheck(
    targetType: 'segment' | 'location',
    targetId: string,
    topic: Topic,
    countries: string[],
  ) {
    const matches = observations.filter(
      (item) =>
        item.topic === topic &&
        (targetType === 'segment' ? item.segmentId === targetId : item.locationId === targetId) &&
        (!item.countryCode || countries.includes(item.countryCode)),
    );
    checklist.push({
      targetType,
      targetId,
      topic,
      status: !matches.length
        ? 'missing_reference'
        : matches.some((item) => item.freshness === 'caller_reported_current')
          ? 'reference_supplied_not_verified'
          : 'needs_fresh_verification',
      sourceRefs: [...new Set(matches.map((item) => item.sourceRef))].sort(),
    });
  }
  for (const segment of segments) {
    const topics = requiredTopics(segment.mode);
    if (segment.scale === 'international') topics.push('entry', 'customs', 'insurance');
    if (supplied.purposes?.some((purpose) => purpose === 'business' || purpose === 'hybrid'))
      topics.push('business');
    for (const topic of [...new Set(topics)])
      addCheck('segment', segment.id, topic, segment.countryCodes);
  }
  for (const location of locations.values()) {
    for (const topic of supplied.researchTopics ?? [])
      addCheck('location', location.id, topic, location.countryCode ? [location.countryCode] : []);
  }
  const connections = segments.slice(1).map((segment, index) => {
    const previous = segments[index]!;
    const declaredMinimum = supplied.segments[index + 1]!.minimumConnectionMinutes;
    const availableMinutes =
      previous.arrival.instant && segment.departure.instant
        ? (parseInstant(segment.departure.instant) - parseInstant(previous.arrival.instant)) / 60000
        : null;
    const sameLocation = previous.to !== null && previous.to === segment.from;
    const status =
      !previous.moving || !segment.moving
        ? 'not_a_transport_connection'
        : availableMinutes === null
          ? 'schedule_unknown'
          : availableMinutes < 0
            ? 'overlap'
            : !sameLocation
              ? 'transfer_unverified'
              : declaredMinimum === null
                ? 'minimum_unknown'
                : availableMinutes < declaredMinimum
                  ? 'below_declared_minimum'
                  : 'meets_declared_minimum_not_carrier_verified';
    return {
      fromSegment: previous.id,
      toSegment: segment.id,
      availableMinutes,
      minimumConnectionMinutes: declaredMinimum,
      sameLocation,
      status,
    };
  });
  const countryCodes = [
    ...new Set(
      [...locations.values()].flatMap((location) =>
        location.countryCode ? [location.countryCode] : [],
      ),
    ),
  ].sort();
  const legalSourcePacket = countryCodes.map((countryCode) => ({
    countryCode,
    status: 'applicability_not_evaluated' as const,
    plugins: jurisdictionSourcePlugins
      .filter((plugin) => plugin.countryCodes.includes(countryCode))
      .map((plugin) => ({
        id: plugin.id,
        version: plugin.version,
        coverage: plugin.coverage,
        url: plugin.url,
        topics: [...plugin.topics],
        linkCheckedAt: plugin.linkCheckedAt,
      })),
    nextAction:
      'verify_current_official_country_and_subnational_sources_for_service_date_route_operator_and_traveler_eligibility',
    executableLegalRulesApplied: 0,
  }));
  const unknowns = [
    ...(locale === null ? ['locale'] : []),
    ...(supplied.unitSystem === null ? ['unit_system'] : []),
    ...(supplied.currencies === null ? ['currencies'] : []),
    ...(supplied.purposes === null ? ['travel_purposes'] : []),
    ...(currencies !== null && currencies.length > 1 && supplied.baseCurrency === null
      ? ['base_currency']
      : []),
    ...[...locations.values()].flatMap((location) => [
      ...(location.countryCode === null ? [`location/${location.id}/country`] : []),
      ...(location.timeZone === null ? [`location/${location.id}/time_zone`] : []),
    ]),
  ];
  const result = {
    tripKey: supplied.tripKey,
    language,
    locale,
    dataStatus: 'caller_reported_not_independently_verified' as const,
    locations: [...locations.values()],
    segments,
    connections,
    countryCodes,
    countryCodeValidation:
      'alpha2_syntax_only_not_geocoding_or_assigned_code_verification' as const,
    money: {
      currencies,
      baseCurrency: supplied.baseCurrency,
      conversionRequired: currencies !== null && currencies.length > 1,
      conversionPerformed: false,
      amountsCalculated: false,
      unknownCostsTreatedAsZero: false,
    },
    unitSystem: supplied.unitSystem,
    purposes: supplied.purposes === null ? null : [...supplied.purposes],
    unknowns,
    issues,
    evidence: observations,
    checklist,
    legalSourcePacket,
    entryEligibility: 'not_evaluated_no_nationality_or_residency_assumed' as const,
    runtimeData: {
      icu: process.versions.icu ?? null,
      timeZones: process.versions.tz ?? null,
      note: 'Time-zone/currency metadata comes from this runtime and may need updates before travel.',
    },
    nextActions: [
      ...(unknowns.length ? ['obtain_missing_context_without_collecting_identity_documents'] : []),
      ...(issues.length
        ? ['reconcile_schedule_and_geography_issues_before_declaring_a_viable_itinerary']
        : []),
      ...(connections.some(
        (connection) =>
          !['not_a_transport_connection', 'meets_declared_minimum_not_carrier_verified'].includes(
            connection.status,
          ),
      )
        ? ['verify_connection_transfer_and_operator_conditions']
        : []),
      ...(checklist.some((item) => item.status !== 'reference_supplied_not_verified')
        ? ['collect_or_revalidate_only_missing_relevant_sources']
        : []),
      ...(currencies && currencies.length > 1
        ? ['obtain_dated_explicit_fx_and_rounding_policy_before_aggregating_currencies']
        : []),
      'verify_claims_against_original_sources_and_present_remaining_uncertainty',
    ],
    effects: {
      mode: 'documentary' as const,
      externalCalls: 0,
      modelCalls: 0,
      persistenceWrites: 0,
      permissionsGranted: false,
    },
    verification:
      'Presence, geography codes, source references, validity and connection minima are declarations, not confirmed reservations, legal advice, entry permission or proof of source authenticity.',
  };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 65536)
    reject('GLOBAL_CONTEXT_OUTPUT_LIMIT');
  return result;
}
