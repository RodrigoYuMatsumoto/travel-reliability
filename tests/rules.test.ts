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
    expect(
      rightsFor(trip, event({ waitingMinutes: 61 }), verifiedDate).some((r) =>
        r.ruleId.includes('COMMUNICATION'),
      ),
    ).toBe(false);
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
    expect(
      rightsFor(trip, event({ waitingMinutes: 120 }), verifiedDate).some((r) =>
        r.ruleId.includes('FOOD'),
      ),
    ).toBe(false);
    expect(
      rightsFor(trip, event({ occurredAt: '2026-10-25T12:00:00Z' }), verifiedDate).find(
        (r) => r.ruleId === 'BR-AIR-FOOD-LEGACY',
      )!.status,
    ).toBe('applicable');
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
    const before = rightsFor(trip, event(), verifiedDate).map((r) => r.ruleId);
    expect(before).toContain('BR-AIR-INFORMATION-LEGACY');
    expect(before).not.toContain('BR-AIR-INFORMATION-20261125');
    const after = rightsFor(trip, event({ occurredAt: '2026-11-25T12:00:00Z' }), verifiedDate).map(
      (r) => r.ruleId,
    );
    expect(after).toContain('BR-AIR-INFORMATION-20261125');
    expect(after).not.toContain('BR-AIR-INFORMATION-LEGACY');
  });
  it('keeps food and lodging assistance for events before the 2026 wording', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    const at = (occurredAt: string, waitingMinutes: number) =>
      rightsFor(trip, event({ occurredAt, waitingMinutes, overnight: true }), verifiedDate).map(
        (r) => r.ruleId,
      );
    expect(at('2026-10-25T12:00:00Z', 241)).toEqual(
      expect.arrayContaining([
        'BR-AIR-COMMUNICATION-LEGACY',
        'BR-AIR-FOOD-LEGACY',
        'BR-AIR-LODGING-LEGACY',
      ]),
    );
    expect(at('2026-10-25T12:00:00Z', 241)).not.toContain('BR-AIR-FOOD-2026');
    expect(at('2026-10-26T12:00:00Z', 241)).toEqual(
      expect.arrayContaining(['BR-AIR-FOOD-2026', 'BR-AIR-LODGING-2026']),
    );
    expect(
      at('2026-10-26T12:00:00Z', 241).some(
        (id) => id.endsWith('-LEGACY') && !id.includes('INFORMATION'),
      ),
    ).toBe(false);
    expect(at('2017-03-13T12:00:00Z', 241)).toHaveLength(0);
  });
  it('keeps the national-territory limit of the 2026 air assistance open for review', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    const advice = rightsFor(trip, event({ waitingMinutes: 241, overnight: true }), verifiedDate);
    for (const id of ['BR-AIR-FOOD-2026', 'BR-AIR-LODGING-2026'])
      expect(advice.find((r) => r.ruleId === id)!.status).toBe('needs_review');
    expect(advice.find((r) => r.ruleId === 'BR-AIR-INFORMATION-LEGACY')!.status).toBe('applicable');
  });
  it('offers article 179 alternatives for interstate bus cancellations without a delay threshold', () => {
    const trip = demoTrip();
    trip.services[0]!.kind = 'bus';
    trip.services[0]!.regulatoryScope = 'br_interstate_regular_bus';
    const cancelled = rightsFor(
      trip,
      event({ kind: 'cancellation', waitingMinutes: null }),
      verifiedDate,
    ).map((r) => r.ruleId);
    expect(cancelled).toContain('BR-BUS-ALTERNATIVES-CANCELLATION');
    expect(
      rightsFor(trip, event({ waitingMinutes: 61 }), verifiedDate).map((r) => r.ruleId),
    ).not.toContain('BR-BUS-ALTERNATIVES-CANCELLATION');
  });
  const busTrip = () => {
    const trip = demoTrip();
    trip.services[0]!.kind = 'bus';
    trip.services[0]!.regulatoryScope = 'br_interstate_regular_bus';
    return trip;
  };
  const statusOf = (advice: ReturnType<typeof rightsFor>, id: string) =>
    advice.find((r) => r.ruleId === id)?.status;
  it('keeps article 179 alternatives when the bus passenger chooses a refund (art. 179, IV)', () => {
    const advice = rightsFor(
      busTrip(),
      event({ waitingMinutes: 181, refundChoice: 'refund' }),
      verifiedDate,
    );
    expect(statusOf(advice, 'BR-BUS-ALTERNATIVES')).toBe('applicable');
    // Article 182: no assistance after a full refund unless an incident, accident or robbery.
    expect(statusOf(advice, 'BR-BUS-CONTINUITY')).toBe('needs_review');
    expect(
      statusOf(
        rightsFor(
          busTrip(),
          event({ kind: 'cancellation', waitingMinutes: null, refundChoice: 'unknown' }),
          verifiedDate,
        ),
        'BR-BUS-ALTERNATIVES-CANCELLATION',
      ),
    ).toBe('applicable');
  });
  it('offers article 179 alternatives for provider-caused bus disruptions in transit (art. 178, V)', () => {
    const inTransit = (providerResponsibility: DisruptionEvent['providerResponsibility']) =>
      rightsFor(
        busTrip(),
        event({ phase: 'in_transit', waitingMinutes: 30, providerResponsibility }),
        verifiedDate,
      );
    expect(statusOf(inTransit('yes'), 'BR-BUS-ALTERNATIVES-RESPONSIBILITY')).toBe('applicable');
    expect(statusOf(inTransit('unknown'), 'BR-BUS-ALTERNATIVES-RESPONSIBILITY')).toBe(
      'needs_review',
    );
    expect(statusOf(inTransit('no'), 'BR-BUS-ALTERNATIVES-RESPONSIBILITY')).toBeUndefined();
    expect(inTransit('yes').map((r) => r.ruleId)).not.toContain('BR-BUS-ALTERNATIVES');
    expect(
      statusOf(
        rightsFor(
          busTrip(),
          event({ waitingMinutes: 30, providerResponsibility: 'yes' }),
          verifiedDate,
        ),
        'BR-BUS-ALTERNATIVES-RESPONSIBILITY',
      ),
    ).toBeUndefined();
  });
  it('separates bus lodging and applies the origin-resident exception (art. 181, §§ 2º and 4º)', () => {
    const at = (patch: Partial<DisruptionEvent>) =>
      rightsFor(busTrip(), event({ waitingMinutes: 181, ...patch }), verifiedDate);
    expect(statusOf(at({}), 'BR-BUS-CONTINUITY')).toBe('applicable');
    expect(statusOf(at({}), 'BR-BUS-LODGING')).toBeUndefined();
    expect(statusOf(at({ overnight: true }), 'BR-BUS-LODGING')).toBe('applicable');
    expect(statusOf(at({ overnight: true, residentAtOrigin: true }), 'BR-BUS-LODGING')).toBe(
      'needs_review',
    );
    expect(statusOf(at({ overnight: true, residentAtOrigin: null }), 'BR-BUS-LODGING')).toBe(
      'needs_review',
    );
    expect(statusOf(at({ overnight: true, residentAtOrigin: true }), 'BR-BUS-CONTINUITY')).toBe(
      'applicable',
    );
    expect(statusOf(at({ overnight: true, refundChoice: 'refund' }), 'BR-BUS-LODGING')).toBe(
      'needs_review',
    );
    expect(
      at({ waitingMinutes: 180, overnight: true }).some((r) =>
        r.ruleId.startsWith('BR-BUS-LODGING'),
      ),
    ).toBe(false);
  });
  it('cites the reachable official source pages', () => {
    const trip = demoTrip();
    trip.services[0]!.regulatoryScope = 'br_air_transport';
    const urls = rightsFor(trip, event({ occurredAt: '2026-10-25T12:00:00Z' }), verifiedDate).map(
      (r) => r.sourceUrl,
    );
    expect(
      urls.every((url) => !url.includes('/resolucoes/2016/') && !url.includes('datalegis.net')),
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
