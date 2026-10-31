import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import tripSchema from '../../schema/trip-contract.schema.json' with { type: 'json' };
import type { TripContract } from '../../schema/src/trip-contract.js';
import { Temporal } from '@js-temporal/polyfill';
import { AppError, requireCondition } from './errors.js';
import { canonicalLocale } from '../../schema/src/locale.js';

const ajv = new Ajv2020({
  allErrors: false,
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const check = ajv.compile(tripSchema);
export function instant(time: { local: string; timeZone: string | null }): number | null {
  try {
    const plain = Temporal.PlainDateTime.from(time.local, { overflow: 'reject' });
    if (!time.timeZone) return null;
    return plain.toZonedDateTime(time.timeZone, { disambiguation: 'reject' }).epochMilliseconds;
  } catch {
    throw new AppError('INVALID_OR_AMBIGUOUS_LOCAL_TIME');
  }
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
  for (const service of trip.services) {
    const start = instant(service.start),
      end = instant(service.end);
    if (start !== null && end !== null)
      requireCondition(end >= start, 'SERVICE_END_BEFORE_START', 422);
    if (service.price) {
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
