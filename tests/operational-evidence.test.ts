import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assess, checklist } from '../api/src/assessment.js';
import { demoTrip } from '../api/src/demo.js';
import { redactDocument } from '../api/src/document-erasure.js';
import { calendar } from '../api/src/exports.js';
import { validateTrip } from '../api/src/validation.js';
import type { TripContract } from '../schema/src/trip-contract.js';

const date = '2031-02-11';
const checkout = '2031-02-12';
const source = randomUUID();

function example() {
  const trip = demoTrip();
  trip.startDate = date;
  trip.endDate = checkout;
  const stay = trip.services[2]!;
  stay.start.local = date;
  stay.end.local = checkout + 'T10:30';
  stay.documentIds = [source];
  trip.services = [stay];
  trip.dependencies = [];
  return trip;
}

function policy(stage: 'requested' | 'paid' | 'issued', end: string, scope: boolean | null) {
  const trip = example();
  const stay = trip.services[0]!;
  const leg = {
    ...demoTrip().services[0]!,
    id: 'return-final',
    start: { ...stay.start, local: checkout + 'T10:00' },
    end: { ...stay.end, local: checkout + 'T12:30' },
  };
  const insurance: TripContract['services'][number] = {
    ...stay,
    id: 'policy',
    kind: 'insurance',
    start: { ...stay.start },
    end: { ...stay.end, local: end },
    insuranceEvidence: {
      stage,
      documentId: source,
      returnServiceId: leg.id,
      coversFinalLeg: scope,
    },
  };
  trip.services.push(leg, insurance);
  return trip;
}

const codes = (trip: TripContract) => assess(validateTrip(trip)).findings.map((item) => item.code);

describe('synthetic overnight and final leg evidence', () => {
  it('keeps a documented night without inventing a check-in hour', () => {
    const trip = example();
    expect(codes(trip)).not.toContain('OVERNIGHT_UNCOVERED');
    expect(checklist(trip, 'pre_departure')).toContainEqual(
      expect.objectContaining({ code: 'LOCAL_TIME_CONFIRMED', status: 'pending' }),
    );
    expect(calendar(trip)).toContain('DTSTART;VALUE=DATE:20310211');
    expect(calendar(trip)).toContain('DTEND;VALUE=DATE:20310212');
  });

  it('distinguishes a quote, missing evidence and an absent booking', () => {
    const trip = example();
    trip.services[0]!.reservation.state = 'quote';
    expect(assess(trip).findings).toContainEqual(
      expect.objectContaining({ code: 'OVERNIGHT_UNCOVERED', parameters: { date, quoteOnly: 1 } }),
    );
    trip.services[0]!.reservation.state = 'booked';
    trip.services[0]!.documentIds = [];
    expect(codes(trip)).toContain('OVERNIGHT_EVIDENCE_PENDING');
    trip.services = [];
    expect(codes(trip)).toContain('OVERNIGHT_UNCOVERED');
  });

  it.each(['requested', 'paid'] as const)('does not use a %s policy as coverage', (stage) => {
    expect(codes(policy(stage, '2031-02-13', null))).toContain('INSURANCE_ISSUANCE_UNVERIFIED');
  });

  it('distinguishes an expired policy, an unknown hour and an explicit covered arrival', () => {
    expect(codes(policy('issued', date, true))).toContain('INSURANCE_RETURN_GAP');
    expect(codes(policy('issued', checkout, true))).toContain('INSURANCE_RETURN_UNVERIFIED');
    expect(codes(policy('issued', checkout + 'T13:00', null))).toContain(
      'INSURANCE_RETURN_UNVERIFIED',
    );
    expect(codes(policy('issued', checkout + 'T13:00', false))).toContain('INSURANCE_RETURN_GAP');
    expect(
      codes(policy('issued', checkout + 'T13:00', true)).filter((x) => x.startsWith('INSURANCE_')),
    ).toEqual([]);
  });

  it('requires a linked policy source and exact flight times', () => {
    const trip = policy('issued', checkout, true);
    trip.services[2]!.documentIds = [];
    expect(() => validateTrip(trip)).toThrow('INSURANCE_NEEDS_LINKED_EVIDENCE');
    trip.services[2]!.documentIds = [source];
    trip.services[1]!.end.local = checkout;
    expect(() => validateTrip(trip)).toThrow('DATE_ONLY_NOT_SUPPORTED_FOR_SERVICE');
  });

  it('keeps a policy linked to an earlier return leg pending when the trip has a later arrival', () => {
    const trip = policy('issued', checkout + 'T13:00', true);
    const earlierLeg = trip.services[1]!;
    const finalLeg = {
      ...earlierLeg,
      id: 'onward-final',
      start: { ...earlierLeg.start, local: checkout + 'T14:30' },
      end: { ...earlierLeg.end, local: checkout + 'T16:00' },
    };
    trip.services.push(finalLeg);
    expect(codes(trip)).toContain('INSURANCE_RETURN_UNVERIFIED');
    expect(checklist(trip, 'pre_departure')).toContainEqual(
      expect.objectContaining({ code: 'INSURANCE_RETURN_EVIDENCE', status: 'pending' }),
    );

    trip.services[2]!.insuranceEvidence!.returnServiceId = finalLeg.id;
    expect(codes(trip)).toContain('INSURANCE_RETURN_GAP');

    trip.services[2]!.insuranceEvidence!.returnServiceId = earlierLeg.id;
    finalLeg.reservation = { ...finalLeg.reservation, state: 'cancelled' };
    expect(codes(trip).filter((code) => code.startsWith('INSURANCE_'))).toEqual([]);
  });

  it('keeps the return pending when another active leg has an unknown arrival time zone', () => {
    const trip = policy('issued', checkout + 'T13:00', true);
    const earlierLeg = trip.services[1]!;
    trip.services.push({
      ...earlierLeg,
      id: 'onward-unknown-zone',
      start: { ...earlierLeg.start, local: checkout + 'T14:30' },
      end: { ...earlierLeg.end, local: checkout + 'T16:00', timeZone: null },
    });
    expect(codes(trip)).toContain('INSURANCE_RETURN_UNVERIFIED');
  });

  it('reopens insurance verification when its documentary evidence is erased', () => {
    const trip = policy('issued', checkout + 'T13:00', true);
    expect(codes(trip)).not.toContain('INSURANCE_ISSUANCE_UNVERIFIED');
    const redacted = redactDocument(trip, source);
    expect(redacted.changed).toBe(true);
    expect(redacted.trip.services[2]!.insuranceEvidence).toBeUndefined();
    expect(codes(redacted.trip)).toContain('INSURANCE_ISSUANCE_UNVERIFIED');
  });
});
