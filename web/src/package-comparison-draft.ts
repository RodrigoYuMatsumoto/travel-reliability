import { Temporal } from '@js-temporal/polyfill';
import {
  flightGroundCategories,
  type GroundCategory,
  type GroundOffer,
  type GroundTransportInput,
} from '../../schema/src/ground-transport.js';
import { isIanaTimeZone } from '../../schema/src/time-zone.js';
import type { PackageReference, PackageSearchInput } from './package-discovery';

/** Same IANA rule as the comparator, so a zone accepted here is never rejected there. */
export function requirePackageTimeZone(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('PACKAGE_TIME_ZONE_REQUIRED');
  const timeZone = value.trim();
  if (!isIanaTimeZone(timeZone)) throw new Error('PACKAGE_TIME_ZONE_REJECTED');
  return timeZone;
}

const busCategories: readonly GroundCategory[] = ['outbound_bus', 'return_bus'];
const unusedModeReason = 'Meio de transporte não usado nesta alternativa / Mode not used here';

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
  const offer = (
    id: string,
    provider: string,
    transportMode: 'bus' | 'flight',
    hotelBreakfast: 'included' | 'excluded' | 'unknown',
    agency = false,
  ): GroundOffer => {
    // The other mode's categories are out of scope, not unknown: leaving them unknown
    // makes the comparator report a mode conflict on every alternative.
    const unused: readonly GroundCategory[] =
      transportMode === 'flight' ? busCategories : flightGroundCategories;
    return {
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
      coverage: Object.fromEntries(
        categories.map((category) => [
          category,
          unused.includes(category) ? 'not_required' : 'unknown',
        ]),
      ) as GroundOffer['coverage'],
      notRequiredReasons: Object.fromEntries(
        unused.map((category) => [category, unusedModeReason]),
      ),
      serviceScopeKey: null,
      costs: (agency
        ? ['package' as const]
        : categories.filter((category) => !unused.includes(category))
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
    };
  };
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
