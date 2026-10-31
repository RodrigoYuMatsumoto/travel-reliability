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
    domain: 'flight',
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
  expect(result.recommendedCommands).toEqual([]);
  expect(result.recommendedWorkflows).toEqual(['expense-settlement']);
  expect(result.recommendedTools).toContain('travel_settle_expenses');
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

it('rejects a fully declared empty party while retaining partially unknown composition', () => {
  expect(() => prepareBrief({ ...draft(), party: { adults: 0, children: 0, infants: 0 } })).toThrow(
    'INVALID_AGENT_BRIEF',
  );
  expect(
    prepareBrief({ ...draft(), party: { adults: 0, children: null, infants: 0 } }).brief.party
      .children,
  ).toBeNull();
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
    domain: 'flight',
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

it.each([
  ['lodging', 'compare-lodging'],
  ['ground', 'ground-transport'],
  ['insurance', 'insurance-review'],
  ['health', 'health-plan'],
  ['documents', 'travel-documents'],
])('routes a %s planning request without airline assumptions', (domain, workflowId) => {
  const result = prepareBrief({ tripKey: 'domain-1', request: 'plan', language: 'pt-BR', domain });
  expect(result.recommendedWorkflows).toEqual([workflowId]);
  expect(result.recommendedCommands).toEqual([]);
  expect(result.questions.flatMap((question) => question.fields)).not.toContain('returnTrip');
  expect(result.recommendedWorkflows).not.toContain('airports');
});

it('keeps an unspecified planning domain unknown instead of assuming a flight', () => {
  const result = prepareBrief({ tripKey: 'unknown-mode', request: 'plan', language: 'en' });
  expect(result.unknowns).toContain('domain');
  expect(result.recommendedWorkflows).toEqual(['trip-intake']);
  expect(result.recommendedCommands).toEqual([]);
});

it('resumes and selects explicit catalog workflows without requesting a new destination', () => {
  const result = prepareBrief({ tripKey: 'resume-1', request: 'resume', language: 'pt-BR' });
  expect(result.recommendedWorkflows).toEqual(['resume-trip']);
  expect(result.unknowns).toEqual(['session_checkpoint']);
  const selected = prepareBrief({
    tripKey: 'explicit-1',
    request: 'plan',
    language: 'en',
    workflowId: 'calendar-plan',
  });
  expect(selected.recommendedWorkflows).toEqual(['calendar-plan']);
  expect(selected.recommendedTools).not.toContain('calendar_write');
});

it('keeps disruption triage ahead of a conflicting workflow selection', () => {
  const result = prepareBrief({
    tripKey: 'incident-2',
    request: 'disruption',
    language: 'en',
    workflowId: 'build-itinerary',
    incident: { serviceKind: 'bus', kind: 'cancellation', country: 'BR', ongoing: true },
  });
  expect(result.state).toBe('incident_triage');
  expect(result.recommendedWorkflows).toContain('consumer-rights');
  expect(result.recommendedWorkflows).not.toContain('build-itinerary');
});

it('reuses a supplied incident context instead of asking the same rights intake again', () => {
  const result = prepareBrief({
    tripKey: 'rights-1',
    request: 'rights',
    language: 'pt-BR',
    incident: {
      serviceKind: 'bus',
      country: 'BR',
      kind: 'cancellation',
      ongoing: false,
      occurredAt: '2030-01-01T12:00:00Z',
    },
  });
  expect(result.recommendedWorkflows).toEqual(['consumer-rights']);
  expect(result.unknowns).not.toContain('incident_context');
  expect(result.unknowns).toEqual(['supplier_terms', 'evidence_refs']);
  expect(result.brief.incident.ongoing).toBe(false);
});

it('preserves undeclared functional constraints after party counts are supplied', () => {
  const input = {
    tripKey: 'lodge-1',
    request: 'compare',
    language: 'pt-BR',
    domain: 'lodging',
    destination: 'BBB',
    departureDate: '2030-03-01',
    returnDate: '2030-03-05',
    party: { adults: 1, children: 0, infants: 0 },
  };
  const unknown = prepareBrief(input);
  expect(unknown.unknowns).toContain('mustHaves');
  expect(unknown.unknowns).not.toContain('date_window');
  expect(unknown.questions.some((question) => question.fields.includes('mustHaves'))).toBe(true);
  const explicitEmpty = prepareBrief({ ...input, mustHaves: [] });
  expect(explicitEmpty.unknowns).not.toContain('mustHaves');
  expect(explicitEmpty.unknowns).not.toContain('party_profile');
  const declared = prepareBrief({ ...input, mustHaves: ['step_free'] });
  expect(declared.brief.mustHaves).toEqual(['step_free']);
});

it('distinguishes a budget amount from its declared expense scope', () => {
  const input = {
    tripKey: 'budget-1',
    request: 'compare',
    language: 'en',
    domain: 'budget',
    budget: { minorUnits: 0, currency: 'BRL' },
  };
  const unknown = prepareBrief(input);
  expect(unknown.brief.budget?.minorUnits).toBe(0);
  expect(unknown.brief.budget?.scope).toBeNull();
  expect(unknown.unknowns).toContain('budget.scope');
  const declared = prepareBrief({
    ...input,
    budget: { ...input.budget, scope: 'Entire declared trip' },
  });
  expect(declared.unknowns).not.toContain('budget.scope');
});
