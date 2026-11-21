import { Temporal } from '@js-temporal/polyfill';
import type { TripContract } from '../../schema/src/trip-contract.js';
import type {
  Assessment,
  ChecklistItem,
  DisruptionEvent,
  Finding,
} from '../../schema/src/domain.js';
import { instant, isReturnTransport } from './validation.js';
import { validCnpj } from './cnpj.js';

function insuranceReturn(trip: TripContract, service: TripContract['services'][number]) {
  const evidence = service.insuranceEvidence;
  if (evidence?.stage !== 'issued') return 'INSURANCE_ISSUANCE_UNVERIFIED';
  const transport = trip.services.filter(
    (item) => isReturnTransport(item) && ['booked', 'completed'].includes(item.reservation.state),
  );
  const leg = transport.find((item) => item.id === evidence.returnServiceId);
  if (!leg) return 'INSURANCE_RETURN_UNVERIFIED';
  const expiry = instant(service.end);
  const arrival = instant(leg.end);
  // Date-only evidence cannot prove an instant across zones, including the expiry day.
  const sameZone = !!service.end.timeZone && service.end.timeZone === leg.end.timeZone;
  const expiryDay = service.end.local.slice(0, 10);
  const arrivalDay = leg.end.local.slice(0, 10);
  // A gap on the declared return leg is proven whatever the order of the other legs.
  if (
    evidence.coversFinalLeg === false ||
    (expiry !== null && arrival !== null && expiry < arrival) ||
    (sameZone && (expiry === null || arrival === null) && expiryDay < arrivalDay)
  )
    return 'INSURANCE_RETURN_GAP';
  for (const other of transport) {
    if (other.id === leg.id) continue;
    const otherArrival = instant(other.end);
    if (arrival === null || otherArrival === null || otherArrival > arrival)
      return 'INSURANCE_RETURN_UNVERIFIED';
  }
  if (
    evidence.coversFinalLeg !== true ||
    !(
      (expiry !== null && arrival !== null && expiry >= arrival) ||
      (sameZone && expiryDay > arrivalDay)
    )
  )
    return 'INSURANCE_RETURN_UNVERIFIED';
  return null;
}

// Return coverage belongs to the trip: one active issued policy covering the final arrival
// is enough, even when a complementary policy ends earlier. Issuance stays per policy.
function returnCovered(trip: TripContract) {
  return trip.services.some(
    (service) =>
      service.kind === 'insurance' &&
      service.reservation.state !== 'cancelled' &&
      service.reservation.confirmation !== 'failed' &&
      insuranceReturn(trip, service) === null,
  );
}

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
  const tripReturnCovered = returnCovered(trip);
  for (const s of trip.services.filter((s) => s.reservation.state !== 'cancelled')) {
    const booked = ['booked', 'completed'].includes(s.reservation.state);
    field(!!s.price);
    field(!!s.cancellation.summary);
    field(!!s.provider.contact);
    field(s.provider.registration.status !== 'unknown');
    if (s.country === 'BR')
      field(
        !!s.provider.cadastur &&
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
      /^(?:BR:)?CNPJ$/i.test(s.provider.registration.scheme ?? '') &&
      s.provider.registration.value &&
      !validCnpj(s.provider.registration.value)
    )
      add('REGISTRATION_FORMAT_INVALID', 'warning', s.id);
    if (
      s.country === 'BR' &&
      s.provider.cadastur?.applicability === 'required' &&
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
    if (s.kind === 'insurance') {
      const issue = insuranceReturn(trip, s);
      if (issue && !(tripReturnCovered && issue !== 'INSURANCE_ISSUANCE_UNVERIFIED'))
        add(issue, issue === 'INSURANCE_RETURN_GAP' ? 'critical' : 'warning', s.id);
    }
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
    const candidates = trip.services.filter(
      (s) =>
        s.reservation.state !== 'cancelled' &&
        s.reservation.confirmation !== 'failed' &&
        [
          'hotel',
          'rental_home',
          'hostel',
          'camping',
          'homestay',
          'cruise',
          'flight',
          'bus',
          'rail',
          'ferry',
        ].includes(s.kind) &&
        s.start.local.slice(0, 10) <= day &&
        s.end.local.slice(0, 10) > day,
    );
    const covered =
      trip.overnightExemptions.some((e) => e.date === day) ||
      candidates.some(
        (s) => ['booked', 'completed'].includes(s.reservation.state) && s.documentIds.length > 0,
      );
    if (!covered) {
      if (candidates.some((s) => s.reservation.state !== 'quote'))
        add('OVERNIGHT_EVIDENCE_PENDING', 'warning', undefined, { date: day });
      else
        add('OVERNIGHT_UNCOVERED', 'critical', undefined, {
          date: day,
          quoteOnly: candidates.length ? 1 : 0,
        });
    }
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
  const tripReturnCovered = returnCovered(trip);
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
      s.provider.cadastur?.applicability === 'required' && s.provider.cadastur.status === 'active',
      s.country === 'BR' &&
        !['not_applicable', 'optional'].includes(s.provider.cadastur?.applicability ?? 'unknown'),
    );
    if (phase === 'pre_departure') {
      item('RESERVATION_REFERENCE', !!s.reservation.reference);
      item('PROVIDER_CONFIRMATION', s.reservation.confirmation === 'confirmed');
      item('EVIDENCE_ATTACHED', !!s.documentIds.length);
      item('BAGGAGE_TERMS', !!s.baggage, ['flight', 'bus'].includes(s.kind));
      item('LOCAL_TIME_CONFIRMED', instant(s.start) !== null && instant(s.end) !== null);
      if (s.kind === 'insurance') item('INSURANCE_RETURN_EVIDENCE', tripReturnCovered);
      for (const requirement of s.requirements)
        item('REQUIREMENT:' + requirement.code, requirement.status === 'confirmed');
    }
  }
  return result;
}
