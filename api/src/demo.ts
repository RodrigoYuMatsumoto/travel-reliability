import { randomUUID } from 'node:crypto';
import type { TripContract } from '../../schema/src/trip-contract.js';
type Service = TripContract['services'][number];
export function demoTrip(): TripContract {
  const service = (
    id: string,
    kind: Service['kind'],
    title: string,
    start: string,
    end: string,
  ): Service => ({
    id,
    kind,
    title,
    country: 'BR',
    provider: {
      name: 'Synthetic Provider ' + id,
      category: kind === 'flight' ? 'airline' : kind === 'hotel' ? 'hotel' : 'bus_operator',
      registration: {
        scheme: null,
        value: null,
        status: 'unknown',
        sourceUrl: null,
        checkedAt: null,
      },
      cadastur: { applicability: 'unknown', status: 'unknown', sourceUrl: null, checkedAt: null },
      contact: 'https://provider.example.invalid/support',
    },
    reservation: {
      state: 'booked',
      reference: 'SYNTHETIC-' + id.toUpperCase(),
      confirmation: 'not_checked',
      confirmationDocumentId: null,
      paymentChannel: 'platform',
    },
    start: { local: start, timeZone: 'America/Sao_Paulo' },
    end: { local: end, timeZone: 'America/Sao_Paulo' },
    location: 'Synthetic location — not a real reservation',
    price: {
      currency: 'BRL',
      baseMinor: kind === 'hotel' ? 60000 : 30000,
      fees: [{ label: 'Synthetic fee', amountMinor: 2500 }],
      totalMinor: kind === 'hotel' ? 62500 : 32500,
    },
    cancellation: { summary: null, deadline: null, documentId: null },
    baggage: kind === 'flight' ? 'Synthetic allowance: verify supplier terms' : null,
    documentIds: [],
    requirements: [],
  });
  return {
    schemaVersion: '1.0.0',
    id: randomUUID(),
    title: 'Demonstração · conexão e hospedagem',
    country: 'BR',
    currency: 'BRL',
    locale: 'pt-BR',
    startDate: '2026-10-29',
    endDate: '2026-10-31',
    travelers: [
      { id: 'traveler-a', label: 'Traveler A', ageGroup: 'adult', needs: [] },
      {
        id: 'traveler-b',
        label: 'Traveler B',
        ageGroup: 'infant',
        needs: ['child_seat', 'quiet_breaks'],
      },
    ],
    services: [
      service('flight-a', 'flight', 'Voo de demonstração', '2026-10-29T09:00', '2026-10-29T11:00'),
      service(
        'bus-a',
        'bus',
        'Conexão rodoviária de demonstração',
        '2026-10-29T11:45',
        '2026-10-29T13:30',
      ),
      service(
        'hotel-a',
        'hotel',
        'Hospedagem de demonstração',
        '2026-10-29T15:00',
        '2026-10-30T11:00',
      ),
    ],
    dependencies: [
      { from: 'flight-a', to: 'bus-a', minimumMinutes: 90, basis: 'traveler_preference' },
    ],
    overnightExemptions: [],
  };
}
