import { it, expect } from 'vitest';
import { prepareBrief } from '../agent/brief.js';

const draft = () => ({
  groupMode: 'planning',
  tripKey: 'trip-1',
  request: 'group',
  language: 'pt-BR',
  origin: null,
  destination: null,
  departureDate: null,
  returnTrip: null,
  returnDate: null,
  party: { adults: null, children: null, infants: null, households: null },
  budget: null,
  mustHaves: null,
});
it('keeps a trip intake pseudonymous, unknown and limited to five critical question groups', () => {
  const result = prepareBrief(draft());
  expect(result.state).toBe('needs_critical_information');
  expect(result.questions).toHaveLength(5);
  expect(result.unknowns).toContain('budget');
  expect(result.recommendedCommands[0]).toBe('group-split');
  expect(result.brief.party.children).toBeNull();
  expect(() => prepareBrief({ ...draft(), passport: 'SYNTHETIC-ONLY' })).toThrow(
    'INVALID_AGENT_BRIEF',
  );
});

it('triages incidents without blocking assistance on planning questions or inventing flight workflows', () => {
  const result = prepareBrief({
    tripKey: 'incident-1',
    request: 'disruption',
    language: 'en',
    incident: { serviceKind: 'lodging', kind: 'cancellation', country: 'BR', ongoing: true },
  });
  expect(result.state).toBe('incident_triage');
  expect(result.nextActions[0]).toBe('prioritize_safety_and_provider_assistance');
  expect(result.recommendedCommands).toEqual([]);
  expect(result.unknowns).toEqual(['incident.occurredAt']);
  expect(result.unknowns).not.toContain('returnDate');
});

it('marks only missing return information unknown and uses canonical executable command IDs', () => {
  const result = prepareBrief({
    tripKey: 'trip-2',
    request: 'compare',
    language: 'en',
    origin: 'AAA',
    destination: 'BBB',
    departureDate: '2030-03-01',
    returnTrip: true,
    party: { adults: 1, children: 0, infants: 0 },
    mustHaves: [],
  });
  expect(result.unknowns).toEqual(['returnDate', 'budget']);
  expect(result.recommendedCommands).toContain('total-cost');
});

it('handles existing group expenses without asking for new destinations or traveler composition', () => {
  const result = prepareBrief({
    tripKey: 'split-1',
    request: 'group',
    groupMode: 'expenses_only',
    language: 'pt-BR',
    party: { households: 2 },
  });
  expect(result.state).toBe('ready_for_expense_evidence');
  expect(result.questions).toEqual([]);
  expect(result.recommendedCommands).toEqual(['group-split']);
});

it('represents a declared unaccompanied minor without assuming eligibility or an adult companion', () => {
  const result = prepareBrief({
    tripKey: 'minor-1',
    request: 'plan',
    language: 'en',
    party: { adults: 0, children: 1, infants: 0 },
  });
  expect(result.brief.party.adults).toBe(0);
  expect(result.anticipatoryChecks).toContain(
    'unaccompanied_minor_eligibility_requires_carrier_and_jurisdiction_verification',
  );
});

it('asks the group scope before expanding an ambiguous request into new travel research', () => {
  const result = prepareBrief({ tripKey: 'group-1', request: 'group', language: 'en' });
  expect(result.state).toBe('needs_group_mode');
  expect(result.questions).toHaveLength(1);
  expect(result.unknowns).toEqual(['groupMode']);
});
it('preserves explicit zeros and contradictory dates require correction', () => {
  const known = {
    ...draft(),
    request: 'compare',
    origin: 'AAA',
    destination: 'BBB',
    departureDate: '2030-03-01',
    returnTrip: false,
    party: { adults: 1, children: 0, infants: 0, households: 1 },
    budget: { minorUnits: 0, currency: 'BRL' },
    mustHaves: [],
  };
  const result = prepareBrief(known);
  expect(result.state).toBe('ready_for_evidence_collection');
  expect(result.unknowns).not.toContain('budget');
  expect(result.brief.budget?.minorUnits).toBe(0);
  expect(() => prepareBrief({ ...known, returnDate: '2030-03-02' })).toThrow(
    'CONFLICTING_TRIP_DATES',
  );
  expect(() => prepareBrief({ ...known, returnTrip: true, returnDate: '2030-02-28' })).toThrow(
    'CONFLICTING_TRIP_DATES',
  );
});
