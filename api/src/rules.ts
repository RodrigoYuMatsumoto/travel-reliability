import { Temporal } from '@js-temporal/polyfill';
import country from '../../rules/br/rules.json' with { type: 'json' };
import type { TripContract } from '../../schema/src/trip-contract.js';
import type { DisruptionEvent, RuleAdvice } from '../../schema/src/domain.js';
import { AppError } from './errors.js';
interface Rule {
  id: string;
  scope: string;
  kinds: string[];
  waitingMinutesGt?: number;
  departureOnly?: boolean;
  overnightOrAssistance?: boolean;
  nationalTerritoryOnly?: boolean;
  componentConditionsUnmodeled?: boolean;
  validFrom: string;
  validTo: string | null;
  article: string;
  sourceUrl: string;
  messageKey: string;
  evidenceCodes: string[];
}
/** Stable reason: the rule is in force on some candidate civil dates and not on others. */
export const EFFECTIVE_DATE_AMBIGUOUS = 'EFFECTIVE_DATE_AMBIGUOUS';
export interface RuleAdviceResult extends RuleAdvice {
  /** Stable codes for the review causes recorded explicitly; absent when none applies. */
  reviewReasons?: string[];
}
// One IANA zone per current Brazilian UTC offset (-2 to -5); offsets come from the tz
// database. Which zone governs a rule's effective date is a legal question this module
// does not settle; it only checks whether the answer could change the outcome.
const BRAZIL_ZONES = [
  'America/Noronha',
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Rio_Branco',
] as const;
/**
 * Distinct civil dates of an instant across the Brazilian zones, ascending. The offset the
 * instant was written with does not matter: "-03:00" and "Z" spellings give the same dates.
 */
export function brazilCivilDates(occurredAt: string): string[] {
  let moment: Temporal.Instant;
  try {
    moment = Temporal.Instant.from(occurredAt);
  } catch {
    throw new AppError('INVALID_EVENT_TIME', 422);
  }
  const dates = BRAZIL_ZONES.map((zone) =>
    moment.toZonedDateTimeISO(zone).toPlainDate().toString(),
  );
  return [...new Set(dates)].sort();
}
export function rightsFor(
  trip: TripContract,
  event: DisruptionEvent,
  now = new Date(),
): RuleAdviceResult[] {
  const service = trip.services.find((s) => s.id === event.serviceId);
  if (!service || service.country !== 'BR') return [];
  const dates = brazilCivilDates(event.occurredAt),
    scope = service.regulatoryScope ?? 'unknown';
  const result: RuleAdviceResult[] = [];
  for (const rule of country.rules as Rule[]) {
    if (!rule.kinds.includes(event.kind)) continue;
    // Evaluate the validity window on every candidate date; every other condition below
    // is date-independent, so diverging windows are the only way the outcome can diverge.
    const inForce = dates.map(
      (date) => date >= rule.validFrom && (!rule.validTo || date < rule.validTo),
    );
    if (!inForce.some(Boolean)) continue;
    const effectiveDateAmbiguous = !inForce.every(Boolean);
    const appropriateKind =
      rule.scope === 'br_air_transport' ? service.kind === 'flight' : service.kind === 'bus';
    if (!appropriateKind || (scope !== 'unknown' && scope !== rule.scope)) continue;
    if (
      rule.waitingMinutesGt !== undefined &&
      event.waitingMinutes !== null &&
      event.waitingMinutes <= rule.waitingMinutesGt
    )
      continue;
    if (rule.departureOnly && !['departure', 'unknown'].includes(event.phase)) continue;
    if (rule.overnightOrAssistance && !event.overnight && !event.specialAssistance) continue;
    const uncertain =
      effectiveDateAmbiguous ||
      scope === 'unknown' ||
      now.toISOString().slice(0, 10) > country.reviewAfter ||
      dates.some((date) => date > country.reviewAfter) ||
      (rule.waitingMinutesGt !== undefined && event.waitingMinutes === null) ||
      event.refundChoice !== 'continue' ||
      event.exceptionalConditions !== 'none' ||
      (rule.departureOnly && event.phase === 'unknown') ||
      (rule.overnightOrAssistance && event.residentAtOrigin !== false) ||
      // Article 27(2) can waive overnight need, but the flag proves neither qualification
      // nor the absence of an adequate accommodation accepted by the passenger/companion.
      (rule.overnightOrAssistance && event.specialAssistance && !event.overnight) ||
      // The contract does not record where a wait happened; a territorial limit stays open.
      rule.nationalTerritoryOnly === true ||
      // Aggregate advice cannot certify lodging/transfer facts absent from the event contract.
      rule.componentConditionsUnmodeled === true ||
      (service.kind === 'bus' && event.phase === 'unknown');
    result.push({
      ruleId: rule.id,
      status: uncertain ? 'needs_review' : 'applicable',
      messageKey: rule.messageKey,
      sourceUrl: rule.sourceUrl,
      article: rule.article,
      evidenceCodes: rule.evidenceCodes,
      validFrom: rule.validFrom,
      validTo: rule.validTo,
      ...(effectiveDateAmbiguous ? { reviewReasons: [EFFECTIVE_DATE_AMBIGUOUS] } : {}),
    });
  }
  return result;
}
export function ruleCatalog() {
  return country;
}
