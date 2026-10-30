import { describe, it, expect } from 'vitest';
import { demoTrip } from '../api/src/demo.js';
import { rightsFor } from '../api/src/rules.js';
import type { DisruptionEvent } from '../schema/src/domain.js';
function event(patch: Partial<DisruptionEvent> = {}): DisruptionEvent {
  return {
    id: 'synthetic-event',
    tripId: 'synthetic-trip',
    serviceId: 'flight-a',
    kind: 'delay',
    occurredAt: '2026-10-29T12:00:00Z',
    waitingMinutes: 121,
    overnight: false,
    specialAssistance: false,
    providerResponsibility: 'unknown',
    description: 'Synthetic report',
    documentIds: [],
    amountMinor: null,
    currency: null,
    source: 'user',
    phase: 'departure',
    refundChoice: 'continue',
    residentAtOrigin: false,
    exceptionalConditions: 'none',
    ...patch,
  };
}
const verifiedDate = new Date('2026-10-29T18:00:00Z');
describe('dated Brazil rules', () => {
  it('does not apply revoked one-hour communication rule after 2026-10-26', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    expect(rightsFor(trip, event({ waitingMinutes: 61 }), verifiedDate)).toHaveLength(0);
    expect(
      rightsFor(
        trip,
        event({ occurredAt: '2026-10-25T12:00:00Z', waitingMinutes: 61 }),
        verifiedDate,
      ).some((r) => r.ruleId === 'BR-AIR-COMMUNICATION-LEGACY'),
    ).toBe(true);
  });
  it('tests strict greater-than food and lodging boundaries', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    expect(rightsFor(trip, event({ waitingMinutes: 120 }), verifiedDate)).toHaveLength(0);
    expect(rightsFor(trip, event(), verifiedDate)[0]!.status).toBe('applicable');
    expect(
      rightsFor(trip, event({ waitingMinutes: 240, overnight: true }), verifiedDate).some((r) =>
        r.ruleId.includes('LODGING'),
      ),
    ).toBe(false);
    expect(
      rightsFor(trip, event({ waitingMinutes: 241, overnight: true }), verifiedDate).some((r) =>
        r.ruleId.includes('LODGING'),
      ),
    ).toBe(true);
  });
  it('preserves applicability uncertainty and foreign scope', () => {
    const trip = demoTrip();
    expect(rightsFor(trip, event(), verifiedDate)[0]!.status).toBe('needs_review');
    trip.services[0]!.country = 'US';
    expect(rightsFor(trip, event(), verifiedDate)).toHaveLength(0);
  });
  it('does not apply the future information wording before its effective date', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    expect(
      rightsFor(trip, event(), verifiedDate).some((r) => r.ruleId.includes('INFORMATION')),
    ).toBe(false);
    expect(
      rightsFor(trip, event({ occurredAt: '2026-11-25T12:00:00Z' }), verifiedDate).some((r) =>
        r.ruleId.includes('INFORMATION'),
      ),
    ).toBe(true);
  });
  it('requires review for unknown exceptions or stale rule packs', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    expect(
      rightsFor(trip, event({ exceptionalConditions: 'unknown' }), verifiedDate)[0]!.status,
    ).toBe('needs_review');
    expect(rightsFor(trip, event(), new Date('2027-01-01T00:00:00Z'))[0]!.status).toBe(
      'needs_review',
    );
  });
});
