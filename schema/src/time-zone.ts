import { Temporal } from '@js-temporal/polyfill';

// IANA names are ASCII ("America/Sao_Paulo", "Etc/GMT+3") and start with a letter. This
// excludes UTC offsets ("+03:00", "-0500") and ISO date-time strings, which Temporal
// would otherwise accept as a time zone argument.
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * True only for a tz database name known to the runtime, spelled in its normalized case.
 * Every contract that accepts a zone name shares this check, so one interface cannot accept
 * a zone that another rejects.
 */
export function isIanaTimeZone(id: unknown): id is string {
  if (typeof id !== 'string' || id.length > 100 || !IANA_NAME.test(id)) return false;
  try {
    return Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(id).timeZoneId === id;
  } catch {
    return false;
  }
}
