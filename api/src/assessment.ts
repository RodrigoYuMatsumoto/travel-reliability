import { Temporal } from '@js-temporal/polyfill';
import type { TripContract } from '../../schema/src/trip-contract.js';
import type {
  Assessment,
  ChecklistItem,
  DisruptionEvent,
  Finding,
} from '../../schema/src/domain.js';
import { instant } from './validation.js';

export function assess(
  trip: TripContract,
  events: DisruptionEvent[] = [],
  now = new Date(),
): Assessment {
  const findings: Finding[] = [];
  const totals: Record<string, number> = {};
  let known = 0,
    possible = 0,
    risk = 0;
  const field = (present: boolean) => {
    possible++;
    if (present) known++;
  };
  const add = (
    code: string,
    severity: Finding['severity'],
    serviceId?: string,
    parameters: Finding['parameters'] = {},
    points = 0,
  ) => {
    findings.push({ code, severity, ...(serviceId ? { serviceId } : {}), parameters });
    risk += points;
  };
  for (const s of trip.services.filter((s) => s.reservation.state !== 'cancelled')) {
    const booked = ['booked', 'completed'].includes(s.reservation.state);
    field(!!s.price);
    field(!!s.cancellation.summary);
    field(!!s.provider.contact);
    field(s.provider.registration.status !== 'unknown');
    if (s.country === 'BR')
      field(
        s.provider.cadastur.applicability !== 'unknown' &&
          (s.provider.cadastur.applicability !== 'required' ||
            s.provider.cadastur.status !== 'unknown'),
      );
    if (booked) {
      field(!!s.reservation.reference);
      field(s.documentIds.length > 0);
      field(s.reservation.confirmation !== 'not_checked');
    }
    if (['flight', 'bus'].includes(s.kind)) field(!!s.baggage);
    field(!!s.start.timeZone && !!s.end.timeZone);
    if (s.price) totals[s.price.currency] = (totals[s.price.currency] ?? 0) + s.price.totalMinor;
    else add('PRICE_UNKNOWN', 'warning', s.id);
    if (!s.cancellation.summary) add('POLICY_UNKNOWN', 'warning', s.id);
    if (!s.provider.contact) add('CONTACT_UNKNOWN', 'warning', s.id);
    if (s.provider.registration.status === 'inactive')
      add('REGISTRATION_INACTIVE', 'critical', s.id, {}, 25);
    if (
      s.country === 'BR' &&
      s.provider.cadastur.applicability === 'required' &&
      s.provider.cadastur.status === 'inactive'
    )
      add('CADASTUR_INACTIVE', 'critical', s.id, {}, 20);
    if (s.reservation.paymentChannel === 'outside_agreed_channel')
      add('PAYMENT_CHANNEL_CHANGED', 'critical', s.id, {}, 25);
    if (s.reservation.confirmation === 'failed')
      add('CONFIRMATION_FAILED', 'critical', s.id, {}, 30);
    if (booked && !s.reservation.reference) add('REFERENCE_MISSING', 'warning', s.id);
    if (booked && !s.documentIds.length) add('EVIDENCE_MISSING', 'warning', s.id);
    if (booked && s.reservation.confirmation === 'not_checked')
      add('CONFIRMATION_PENDING', 'warning', s.id);
    if (!s.start.timeZone || !s.end.timeZone) add('TIMEZONE_UNKNOWN', 'warning', s.id);
    if (s.cancellation.deadline) {
      const hours = (Date.parse(s.cancellation.deadline) - now.getTime()) / 3600000;
      if (hours >= 0 && hours <= 168)
        add('CANCELLATION_DEADLINE', 'warning', s.id, { deadline: s.cancellation.deadline });
    }
    for (const requirement of s.requirements)
      if (requirement.status !== 'confirmed')
        add(
          'REQUIREMENT_UNCONFIRMED',
          requirement.status === 'unavailable' ? 'critical' : 'warning',
          s.id,
          { requirement: requirement.code },
        );
  }
  for (const dependency of trip.dependencies) {
    const from = trip.services.find((s) => s.id === dependency.from)!,
      to = trip.services.find((s) => s.id === dependency.to)!;
    if (from.reservation.state === 'cancelled' || to.reservation.state === 'cancelled') {
      add('CONNECTION_CANCELLED', 'critical', to.id);
      continue;
    }
    const end = instant(from.end),
      start = instant(to.start);
    if (end === null || start === null) {
      add('CONNECTION_UNVERIFIABLE', 'warning', to.id);
      continue;
    }
    const delay = Math.max(
      0,
      ...events
        .filter((e) => e.serviceId === from.id && e.kind === 'delay')
        .map((e) => e.waitingMinutes ?? 0),
    );
    const availableMinutes = Math.floor((start - end) / 60000) - delay;
    if (availableMinutes < dependency.minimumMinutes)
      add('CONNECTION_BUFFER', 'critical', to.id, {
        availableMinutes,
        minimumMinutes: dependency.minimumMinutes,
        projected: delay ? 1 : 0,
      });
  }
  let date = Temporal.PlainDate.from(trip.startDate),
    endDate = Temporal.PlainDate.from(trip.endDate);
  while (Temporal.PlainDate.compare(date, endDate) < 0) {
    const day = date.toString();
    const covered =
      trip.overnightExemptions.some((e) => e.date === day) ||
      trip.services.some(
        (s) =>
          s.reservation.state !== 'cancelled' &&
          ((['hotel', 'rental_home'].includes(s.kind) &&
            s.start.local.slice(0, 10) <= day &&
            s.end.local.slice(0, 10) > day) ||
            (['flight', 'bus'].includes(s.kind) &&
              s.start.local.slice(0, 10) <= day &&
              s.end.local.slice(0, 10) > day)),
      );
    if (!covered) add('OVERNIGHT_UNCOVERED', 'critical', undefined, { date: day });
    date = date.add({ days: 1 });
  }
  const coverage = possible ? Math.round((known / possible) * 100) : 0;
  return {
    version: '1.0.0',
    findings,
    riskIndicator: coverage >= 80 ? Math.min(100, risk) : null,
    informationCoveragePercent: coverage,
    riskMeaning: 'heuristic_not_probability',
    totals,
    evaluatedAt: now.toISOString(),
  };
}

export function checklist(
  trip: TripContract,
  phase: 'pre_booking' | 'pre_departure',
): ChecklistItem[] {
  const result: ChecklistItem[] = [];
  for (const s of trip.services) {
    if (s.reservation.state === 'cancelled') continue;
    const item = (code: string, done: boolean, applicable = true) =>
      result.push({
        code,
        serviceId: s.id,
        status: !applicable ? 'not_applicable' : done ? 'complete' : 'pending',
        parameters: {},
      });
    item('PROVIDER_CONTACT', !!s.provider.contact);
    item('CANCELLATION_POLICY', !!s.cancellation.summary);
    item('TOTAL_PRICE', !!s.price);
    item(
      'REGISTRATION_CHECK',
      s.provider.registration.status === 'active',
      s.provider.registration.status !== 'not_applicable',
    );
    item(
      'CADASTUR_CHECK',
      s.provider.cadastur.status === 'active',
      s.country === 'BR' && s.provider.cadastur.applicability === 'required',
    );
    if (phase === 'pre_departure') {
      item('RESERVATION_REFERENCE', !!s.reservation.reference);
      item('PROVIDER_CONFIRMATION', s.reservation.confirmation === 'confirmed');
      item('EVIDENCE_ATTACHED', !!s.documentIds.length);
      item('BAGGAGE_TERMS', !!s.baggage, ['flight', 'bus'].includes(s.kind));
      item('LOCAL_TIME_CONFIRMED', !!s.start.timeZone && !!s.end.timeZone);
      for (const requirement of s.requirements)
        item('REQUIREMENT:' + requirement.code, requirement.status === 'confirmed');
    }
  }
  return result;
}
