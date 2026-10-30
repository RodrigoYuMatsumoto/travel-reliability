import country from '../../rules/br/rules.json' with { type: 'json' };
import type { TripContract } from '../../schema/src/trip-contract.js';
import type { DisruptionEvent, RuleAdvice } from '../../schema/src/domain.js';
interface Rule {
  id: string;
  scope: string;
  kinds: string[];
  waitingMinutesGt?: number;
  departureOnly?: boolean;
  overnightOrAssistance?: boolean;
  validFrom: string;
  validTo: string | null;
  article: string;
  sourceUrl: string;
  messageKey: string;
  evidenceCodes: string[];
}
export function rightsFor(
  trip: TripContract,
  event: DisruptionEvent,
  now = new Date(),
): RuleAdvice[] {
  const service = trip.services.find((s) => s.id === event.serviceId);
  if (!service || service.country !== 'BR') return [];
  const date = event.occurredAt.slice(0, 10),
    scope = service.regulatoryScope ?? 'unknown';
  const result: RuleAdvice[] = [];
  for (const rule of country.rules as Rule[]) {
    if (
      !rule.kinds.includes(event.kind) ||
      date < rule.validFrom ||
      (rule.validTo && date >= rule.validTo)
    )
      continue;
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
      scope === 'unknown' ||
      now.toISOString().slice(0, 10) > country.reviewAfter ||
      date > country.reviewAfter ||
      (rule.waitingMinutesGt !== undefined && event.waitingMinutes === null) ||
      event.refundChoice !== 'continue' ||
      event.exceptionalConditions !== 'none' ||
      (rule.departureOnly && event.phase === 'unknown') ||
      (rule.overnightOrAssistance && event.residentAtOrigin !== false) ||
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
    });
  }
  return result;
}
export function ruleCatalog() {
  return country;
}
