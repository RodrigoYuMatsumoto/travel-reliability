import { Temporal } from '@js-temporal/polyfill';
import type {
  GroundCategory,
  GroundOffer,
  GroundTransportInput,
} from '../../schema/src/ground-transport.js';
import type { PackageReference, PackageSearchInput } from './package-discovery';

export function requirePackageTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('PACKAGE_TIME_ZONE_REQUIRED');
  const timeZone = value.trim();
  if (
    timeZone.length > 100 ||
    !/^(?:UTC|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(timeZone)
  )
    throw new Error('PACKAGE_TIME_ZONE_REJECTED');
  try {
    Temporal.PlainDate.from('2000-01-01').toZonedDateTime({ timeZone, plainTime: '00:00:00' });
  } catch {
    throw new Error('PACKAGE_TIME_ZONE_REJECTED');
  }
  return timeZone;
}

/** A reference link is never a quote. The caller must select a window and origin zone. */
export function createPackageComparisonDraft(
  query: PackageSearchInput,
  source: PackageReference,
  windowIndex: number,
  originTimeZone: string,
): GroundTransportInput {
  if (!Number.isInteger(windowIndex) || windowIndex < 0) throw new Error('PACKAGE_WINDOW_REQUIRED');
  const window = query.windows[windowIndex];
  if (!window) throw new Error('PACKAGE_WINDOW_REQUIRED');
  const url = new URL(source.browserUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('PACKAGE_SOURCE_URL_REJECTED');
  const timeZone = requirePackageTimeZone(originTimeZone);
  const start = Temporal.PlainDate.from(window.startDate).toZonedDateTime({
    timeZone,
    plainTime: '00:00:00',
  });
  const until = Temporal.PlainDate.from(window.endDate).toZonedDateTime({
    timeZone,
    plainTime: '23:59:59',
  });
  if (Temporal.ZonedDateTime.compare(start, until) >= 0) throw new Error('PACKAGE_WINDOW_REJECTED');
  const evaluatedAt = new Date().toISOString();
  const categories: GroundCategory[] = [
    'outbound_bus',
    'return_bus',
    'outbound_flight',
    'return_flight',
    'flight_baggage',
    'flight_seats',
    'airport_transfers',
    'lodging',
    'breakfast',
    'arrival_breakfast',
    'local_transfers',
    'taxes',
    'mandatory_activities',
    'other_meals',
  ];
  const coverage = Object.fromEntries(
    categories.map((category) => [category, 'unknown']),
  ) as GroundOffer['coverage'];
  const offer = (
    id: string,
    provider: string,
    transportMode: 'bus' | 'flight',
    hotelBreakfast: 'included' | 'excluded' | 'unknown',
    agency = false,
  ): GroundOffer => ({
    id,
    provider,
    transportMode,
    kind: agency ? 'agency_package' : 'independent',
    origin: query.origin,
    destination: query.destination ?? 'A confirmar / To confirm',
    yearConfirmed: false,
    departureAt: null,
    arrivalAtDestination: null,
    returnDepartureAt: null,
    returnToOriginAt: null,
    destinationTimeZone: null,
    lodging: {
      checkIn: null,
      checkOut: null,
      declaredNights: null,
      nightsInTransit: null,
      rooms: null,
      roomType: 'unknown',
      occupantsPerRoom: null,
      occupancyConfirmed: null,
      breakfast: hotelBreakfast,
      includedBreakfasts: null,
      externalBreakfasts: null,
      arrivalBreakfastIncluded: null,
    },
    available: null,
    accessibilityConfirmed: null,
    requiredServicesConfirmed: null,
    cancellationPolicyKnown: null,
    coverage: { ...coverage },
    notRequiredReasons: {},
    serviceScopeKey: null,
    costs: (agency
      ? ['package' as const]
      : categories.filter(
          (category) =>
            !(['outbound_bus', 'return_bus'].includes(category) && transportMode === 'flight') &&
            !(
              [
                'outbound_flight',
                'return_flight',
                'flight_baggage',
                'flight_seats',
                'airport_transfers',
              ].includes(category) && transportMode === 'bus'
            ),
        )
    ).map((category, index) => ({
      id: id + '-cost-' + index,
      category,
      unit: 'group',
      quantity: 1,
      unitMinor: null,
      currency: 'BRL',
      treatment: 'necessary',
      selected: true,
      sourceIds: agency ? ['agency-reference'] : [],
    })),
  });
  return {
    evaluatedAt,
    baselineId: 'agency-package',
    requestedWindow: {
      origin: query.origin,
      destination: query.destination,
      earliestDepartureAt: start.toString({ timeZoneName: 'never' }),
      latestReturnAt: until.toString({ timeZoneName: 'never' }),
      timeZone,
    },
    travelerProfile: {
      serviceLevel: 'custom',
      adults: null,
      children: null,
      rooms: null,
      minimumLodgingNights: null,
      minimumBreakfasts: null,
      breakfastRequirement: 'provided_or_budgeted',
      roomType: 'any',
      accessibilityRequired: false,
      budgetMinor: null,
      cashLimitMinor: null,
      currency: 'BRL',
    },
    requiredCategories: categories,
    sources: [
      {
        id: 'agency-reference',
        url: url.href,
        observedAt: evaluatedAt,
        status: 'declared',
        validUntil: null,
        reviewAfter: null,
      },
    ],
    offers: [
      offer('agency-package', source.providerName, 'bus', 'unknown', true),
      offer('bus-breakfast', 'Ônibus + hotel com café — a cotar', 'bus', 'included'),
      offer('bus-no-breakfast', 'Ônibus + hotel sem café — a cotar', 'bus', 'excluded'),
      offer('flight-breakfast', 'Avião + hotel com café — a cotar', 'flight', 'included'),
      offer('flight-no-breakfast', 'Avião + hotel sem café — a cotar', 'flight', 'excluded'),
    ],
  };
}
