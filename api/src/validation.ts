import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import tripSchema from '../../schema/trip-contract.schema.json' with { type: 'json' };
import type { TripContract } from '../../schema/src/trip-contract.js';
import { Temporal } from '@js-temporal/polyfill';
import { AppError, requireCondition } from './errors.js';
import { canonicalLocale } from '../../schema/src/locale.js';
import { currencyMinorUnits, isActiveCurrency } from '../../schema/src/currency.js';

const ajv = new Ajv2020({
  allErrors: false,
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const check = ajv.compile(tripSchema);
// IANA names are ASCII ("America/Sao_Paulo", "Etc/GMT+3") and start with a letter. This
// excludes UTC offsets ("+03:00", "-0500") and ISO date-time strings, which Temporal
// would otherwise accept as a time zone argument.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
/** Accepts only a tz database name known to the runtime, spelled in its normalized case. */
export function assertIanaTimeZone(id: string): string {
  let known: string | null = null;
  if (typeof id === 'string' && IANA_NAME.test(id))
    try {
      known = Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(id).timeZoneId;
    } catch {
      known = null;
    }
  if (known === null || known !== id) throw new AppError('INVALID_TIME_ZONE', 422);
  return id;
}
export function instant(time: { local: string; timeZone: string | null }): number | null {
  let plain: Temporal.PlainDateTime;
  try {
    plain = Temporal.PlainDateTime.from(time.local, { overflow: 'reject' });
  } catch {
    throw new AppError('INVALID_OR_AMBIGUOUS_LOCAL_TIME', 422);
  }
  if (time.timeZone === null) return null;
  const zone = assertIanaTimeZone(time.timeZone);
  try {
    return plain.toZonedDateTime(zone, { disambiguation: 'reject' }).epochMilliseconds;
  } catch {
    throw new AppError('INVALID_OR_AMBIGUOUS_LOCAL_TIME', 422);
  }
}
/** Rejects codes absent from ISO 4217 List One and codes without minor units (XAU, XXX). */
function assertMonetaryCurrency(code: string, path: string) {
  if (!isActiveCurrency(code)) throw new AppError('UNKNOWN_CURRENCY', 422, { path });
  if (currencyMinorUnits(code) === null)
    throw new AppError('CURRENCY_WITHOUT_MINOR_UNITS', 422, { path });
}
export function validateTrip(input: unknown): TripContract {
  if (!check(input))
    throw new AppError(
      'INVALID_CONTRACT',
      422,
      check.errors
        ?.slice(0, 20)
        .map((e) => ({ path: e.instancePath.slice(0, 300), keyword: e.keyword })),
    );
  const trip = input as unknown as TripContract;
  requireCondition(canonicalLocale(trip.locale) !== null, 'INVALID_LOCALE', 422);
  assertMonetaryCurrency(trip.currency, '/currency');
  for (const [index, tour] of (trip.bundledTours ?? []).entries())
    assertMonetaryCurrency(tour.price.currency, `/bundledTours/${index}/price/currency`);
  requireCondition(trip.endDate >= trip.startDate, 'END_BEFORE_START', 422);
  const duration = Temporal.PlainDate.from(trip.startDate).until(
    Temporal.PlainDate.from(trip.endDate),
  ).days;
  requireCondition(duration <= 366, 'TRIP_TOO_LONG', 422);
  const ids = new Set(trip.services.map((s) => s.id));
  requireCondition(ids.size === trip.services.length, 'DUPLICATE_SERVICE_ID', 422);
  requireCondition(
    new Set(trip.travelers.map((t) => t.id)).size === trip.travelers.length,
    'DUPLICATE_TRAVELER_ID',
    422,
  );
  for (const [index, service] of trip.services.entries()) {
    const start = instant(service.start),
      end = instant(service.end);
    // A single known zone cannot order the two local times; both or neither must be known.
    requireCondition(
      (service.start.timeZone === null) === (service.end.timeZone === null),
      'SERVICE_TIME_ZONE_INCOMPLETE',
      422,
    );
    if (start !== null && end !== null)
      requireCondition(end >= start, 'SERVICE_END_BEFORE_START', 422);
    else
      // Without zones, both ends are read as civil time of the same unknown zone.
      requireCondition(
        Temporal.PlainDateTime.compare(
          Temporal.PlainDateTime.from(service.end.local),
          Temporal.PlainDateTime.from(service.start.local),
        ) >= 0,
        'SERVICE_END_BEFORE_START',
        422,
      );
    if (service.price) {
      assertMonetaryCurrency(service.price.currency, `/services/${index}/price/currency`);
      const total =
        service.price.baseMinor + service.price.fees.reduce((sum, f) => sum + f.amountMinor, 0);
      requireCondition(
        Number.isSafeInteger(total) && total === service.price.totalMinor,
        'TOTAL_MISMATCH',
        422,
      );
    }
    if (service.reservation.confirmation === 'confirmed')
      requireCondition(
        service.reservation.confirmationDocumentId &&
          service.documentIds.includes(service.reservation.confirmationDocumentId),
        'CONFIRMATION_NEEDS_EVIDENCE',
        422,
      );
    for (const reg of [service.provider.registration, service.provider.cadastur]) {
      if (!reg) continue;
      if (reg.status === 'active' || reg.status === 'inactive') {
        requireCondition(reg.sourceUrl && reg.checkedAt, 'REGISTRATION_NEEDS_PROVENANCE', 422);
        requireCondition(/^https:\/\//i.test(reg.sourceUrl), 'PROVENANCE_REQUIRES_HTTPS', 422);
      }
    }
    if (service.cancellation.documentId)
      requireCondition(
        service.documentIds.includes(service.cancellation.documentId),
        'POLICY_DOCUMENT_NOT_LINKED',
        422,
      );
    for (const documentId of Object.values(service.fieldSources ?? {}))
      requireCondition(service.documentIds.includes(documentId!), 'FIELD_SOURCE_NOT_LINKED', 422);
  }
  for (const dependency of trip.dependencies)
    requireCondition(
      ids.has(dependency.from) && ids.has(dependency.to) && dependency.from !== dependency.to,
      'INVALID_DEPENDENCY',
      422,
    );
  // Bundled tours: unique ids, every service tag points to a listed tour, and a stored
  // comparison keeps its own arithmetic (package minus unbundled) consistent.
  const tours = trip.bundledTours ?? [];
  const tourIds = new Set(tours.map((tour) => tour.id));
  requireCondition(tourIds.size === tours.length, 'DUPLICATE_BUNDLED_TOUR_ID', 422);
  for (const service of trip.services)
    if (service.bundle)
      requireCondition(tourIds.has(service.bundle.tourId), 'UNKNOWN_BUNDLED_TOUR', 422);
  for (const tour of tours) {
    const c = tour.comparison;
    if (c.status === 'not_compared')
      requireCondition(
        c.evaluatedAt === null &&
          c.classification === null &&
          c.deltaMinor === null &&
          c.receiptSha256 === null,
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
    if (c.status !== 'not_compared')
      requireCondition(
        c.evaluatedAt !== null &&
          c.receiptSha256 !== null &&
          Date.parse(c.evaluatedAt) >= Date.parse(tour.observedAt),
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
    if (c.status === 'final')
      requireCondition(
        c.packageTotalMinor !== null &&
          c.unbundledTotalMinor !== null &&
          c.classification !== 'not_computable',
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
    if (c.deltaMinor !== null)
      requireCondition(
        c.packageTotalMinor !== null && c.unbundledTotalMinor !== null,
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
    if (c.packageTotalMinor !== null && c.unbundledTotalMinor !== null)
      requireCondition(
        c.deltaMinor === c.packageTotalMinor - c.unbundledTotalMinor,
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
    const expected =
      c.deltaMinor === null
        ? [null, 'not_computable']
        : [c.deltaMinor > 0 ? 'agency_premium' : c.deltaMinor < 0 ? 'agency_discount' : 'parity'];
    if (c.status !== 'not_compared')
      requireCondition(
        expected.includes(c.classification),
        'BUNDLED_TOUR_COMPARISON_INCONSISTENT',
        422,
      );
  }
  // Detect dependency cycles; a chain cannot depend on its own completion.
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) throw new AppError('DEPENDENCY_CYCLE', 422);
    if (visited.has(id)) return;
    active.add(id);
    for (const next of trip.dependencies.filter((d) => d.from === id)) visit(next.to);
    active.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return trip;
}
export function assertPlainObject(value: unknown): asserts value is Record<string, unknown> {
  requireCondition(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'EXPECTED_OBJECT',
    422,
  );
}
export function boundedText(value: unknown, max = 4000): string {
  requireCondition(typeof value === 'string' && value.length <= max, 'INVALID_TEXT', 422);
  return value;
}
