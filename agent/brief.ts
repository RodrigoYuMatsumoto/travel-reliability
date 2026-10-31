import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { Temporal } from '@js-temporal/polyfill';
import { AppError } from '../api/src/errors.js';
import { commandIds, domainIds, getCommand } from './catalog.js';
import { prepareWorkflow } from './workflow.js';

const requestIds = [
  'plan',
  'compare',
  'group',
  'change',
  'cancel',
  'disruption',
  'corporate',
  'organize',
  'itinerary',
  'documents',
  'insurance',
  'health',
  'accessibility',
  'points',
  'rights',
  'evidence',
  'risk',
  'calendar',
  'monitor',
  'resume',
  'deliver',
  'audit',
  'ecosystem',
] as const;

const nullableText = { type: ['string', 'null'], minLength: 1, maxLength: 120 };
const nullableCount = { type: ['integer', 'null'], minimum: 0, maximum: 100 };
export const briefSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tripKey', 'request', 'language'],
  properties: {
    tripKey: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' },
    request: { enum: requestIds },
    language: { enum: ['pt-BR', 'en'] },
    domain: { enum: [...domainIds, null] },
    workflowId: { enum: [...commandIds, null] },
    groupMode: { enum: ['planning', 'expenses_only', null] },
    incident: {
      type: ['object', 'null'],
      additionalProperties: false,
      properties: {
        serviceKind: { enum: ['flight', 'bus', 'lodging', 'tour', 'rental', 'other', null] },
        kind: {
          enum: [
            'delay',
            'cancellation',
            'denied_boarding',
            'baggage',
            'service_issue',
            'refund',
            'other',
            null,
          ],
        },
        country: { type: ['string', 'null'], pattern: '^[A-Z]{2}$' },
        occurredAt: { type: ['string', 'null'], format: 'date-time' },
        scheduledAt: { type: ['string', 'null'], format: 'date-time' },
        ongoing: { type: ['boolean', 'null'] },
      },
    },
    origin: nullableText,
    destination: nullableText,
    departureDate: { type: ['string', 'null'], format: 'date' },
    returnTrip: { type: ['boolean', 'null'] },
    returnDate: { type: ['string', 'null'], format: 'date' },
    party: {
      type: ['object', 'null'],
      additionalProperties: false,
      not: {
        type: 'object',
        required: ['adults', 'children', 'infants'],
        properties: {
          adults: { const: 0 },
          children: { const: 0 },
          infants: { const: 0 },
        },
      },
      properties: {
        adults: nullableCount,
        children: nullableCount,
        infants: nullableCount,
        households: { ...nullableCount, minimum: 1 },
      },
    },
    budget: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['minorUnits', 'currency'],
          properties: {
            minorUnits: { type: 'integer', minimum: 0, maximum: 9000000000000 },
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            scope: nullableText,
          },
        },
      ],
    },
    mustHaves: {
      type: ['array', 'null'],
      maxItems: 12,
      uniqueItems: true,
      items: {
        enum: [
          'step_free',
          'stroller',
          'checked_bag',
          'car_seat',
          'flexible_cancellation',
          'stable_internet',
          'no_separate_tickets',
        ],
      },
    },
  },
} as const;
interface Brief {
  tripKey: string;
  request: (typeof requestIds)[number];
  language: 'pt-BR' | 'en';
  domain: (typeof domainIds)[number] | null;
  workflowId: string | null;
  groupMode: 'planning' | 'expenses_only' | null;
  incident: {
    serviceKind: 'flight' | 'bus' | 'lodging' | 'tour' | 'rental' | 'other' | null;
    kind:
      | 'delay'
      | 'cancellation'
      | 'denied_boarding'
      | 'baggage'
      | 'service_issue'
      | 'refund'
      | 'other'
      | null;
    country: string | null;
    occurredAt: string | null;
    scheduledAt: string | null;
    ongoing: boolean | null;
  };
  origin: string | null;
  destination: string | null;
  departureDate: string | null;
  returnTrip: boolean | null;
  returnDate: string | null;
  party: {
    adults: number | null;
    children: number | null;
    infants: number | null;
    households: number | null;
  };
  budget: { minorUnits: number; currency: string; scope: string | null } | null;
  mustHaves: string[] | null;
}
const ajv = new Ajv2020({ strict: true, allErrors: false });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validate = ajv.compile(briefSchema);

/** A stateless intake, not an identity store, price search or booking engine. */
export function prepareBrief(input: unknown) {
  if (!validate(input)) throw new AppError('INVALID_AGENT_BRIEF', 422);
  const supplied = input as Partial<Brief>;
  const brief: Brief = {
    tripKey: supplied.tripKey!,
    request: supplied.request!,
    language: supplied.language!,
    domain: supplied.domain ?? null,
    workflowId: supplied.workflowId ?? null,
    origin: supplied.origin ?? null,
    destination: supplied.destination ?? null,
    departureDate: supplied.departureDate ?? null,
    returnTrip: supplied.returnTrip ?? null,
    returnDate: supplied.returnDate ?? null,
    budget: supplied.budget ? { ...supplied.budget, scope: supplied.budget.scope ?? null } : null,
    mustHaves: supplied.mustHaves ?? null,
    groupMode: supplied.groupMode ?? null,
    party: {
      adults: supplied.party?.adults ?? null,
      children: supplied.party?.children ?? null,
      infants: supplied.party?.infants ?? null,
      households: supplied.party?.households ?? null,
    },
    incident: {
      serviceKind: supplied.incident?.serviceKind ?? null,
      kind: supplied.incident?.kind ?? null,
      country: supplied.incident?.country ?? null,
      occurredAt: supplied.incident?.occurredAt ?? null,
      scheduledAt: supplied.incident?.scheduledAt ?? null,
      ongoing: supplied.incident?.ongoing ?? null,
    },
  };
  if (brief.departureDate) Temporal.PlainDate.from(brief.departureDate, { overflow: 'reject' });
  if (brief.returnDate) Temporal.PlainDate.from(brief.returnDate, { overflow: 'reject' });
  if (
    (brief.returnTrip === false && brief.returnDate !== null) ||
    (brief.departureDate && brief.returnDate && brief.returnDate < brief.departureDate)
  )
    throw new AppError('CONFLICTING_TRIP_DATES', 422);
  const pt = brief.language === 'pt-BR';
  const questions: Array<{ fields: string[]; question: string }> = [];
  const add = (fields: string[], br: string, en: string) =>
    questions.push({ fields, question: pt ? br : en });
  const routedWorkflows = (genericWorkflow: string, commands: string[]) => {
    if (genericWorkflow === 'incident_response')
      return ['manage-risk', 'consumer-rights', 'claim-dossier'];
    if (genericWorkflow === 'service_change_or_refund') return ['consumer-rights', ...commands];
    if (genericWorkflow === 'expense_allocation') return ['expense-settlement'];
    return commands;
  };
  const result = (
    state: string,
    genericWorkflow: string,
    recommendedCommands: string[],
    nextActions: string[],
    anticipatoryChecks: string[],
    planning = false,
  ) => ({
    tripKey: brief.tripKey,
    state,
    genericWorkflow,
    brief,
    questions: questions.slice(0, 5),
    recommendedCommands,
    recommendedWorkflows: routedWorkflows(genericWorkflow, recommendedCommands),
    recommendedAgents: [
      ...new Set(
        routedWorkflows(genericWorkflow, recommendedCommands).map((id) => getCommand(id).agentId),
      ),
    ],
    recommendedTools:
      genericWorkflow === 'expense_allocation'
        ? ['travel_schema', 'travel_settle_expenses']
        : [
            'travel_catalog',
            'travel_workflow',
            ...(recommendedCommands.length ? ['travel_plan'] : []),
          ],
    unknowns: [
      ...new Set([
        ...questions.flatMap((question) => question.fields),
        ...(planning && brief.budget === null ? ['budget'] : []),
      ]),
    ],
    nextActions,
    anticipatoryChecks,
    limits: [
      'no_live_inventory_or_supplier_confirmation',
      'unknown_is_not_zero_or_false',
      'no_prediction_guarantee',
      'no_booking_payment_or_message_execution',
      'no_model_provider_calls_or_local_persistence',
    ],
  });
  if (['disruption', 'change', 'cancel'].includes(brief.request)) {
    const contextMissing = ['serviceKind', 'country']
      .filter((key) => brief.incident[key as 'serviceKind' | 'country'] === null)
      .map((key) => `incident.${key}`);
    if (contextMissing.length)
      add(
        contextMissing,
        'Qual serviço foi afetado e em qual país? Não envie localizador ou documento pessoal.',
        'Which service is affected, and in which country? Do not send a booking code or identity document.',
      );
    if (brief.request === 'disruption') {
      const eventMissing = ['kind', 'ongoing', 'occurredAt']
        .filter((key) => brief.incident[key as 'kind' | 'ongoing' | 'occurredAt'] === null)
        .map((key) => `incident.${key}`);
      if (eventMissing.length)
        add(
          eventMissing,
          'O que ocorreu, ainda está acontecendo e quais são os horários conhecidos com fuso?',
          'What happened, is it ongoing, and what times and zones are known?',
        );
      return result(
        'incident_triage',
        'incident_response',
        brief.incident.serviceKind === 'flight' ? ['connections', 'fare-scenarios'] : [],
        [
          'prioritize_safety_and_provider_assistance',
          'record_actual_and_scheduled_times_without_guessing',
          'preserve_originals_and_provider_responses_privately',
          'verify_official_rules_for_this_country_and_service',
          'prepare_backup_options_without_unapproved_spending',
        ],
        [
          'immediate_assistance',
          'missed_connections_and_overnight_coverage',
          'evidence_and_claim_deadlines',
          'declared_accessibility_and_dependents_needs',
        ],
      );
    }
    if (!brief.departureDate)
      add(
        ['departureDate'],
        'Qual é a data conhecida do serviço para conferir os prazos da política?',
        'What is the known service date for checking policy deadlines?',
      );
    return result(
      questions.length ? 'needs_policy_context' : 'ready_for_policy_evidence',
      'service_change_or_refund',
      brief.incident.serviceKind === 'flight' ? ['fare-scenarios', 'negotiation'] : [],
      [
        'collect_original_terms_and_current_supplier_response',
        'separate_cash_refund_credit_fees_and_unknown_amounts',
        'verify_applicable_jurisdiction_and_deadlines',
        'preview_any_requested_change_or_cancellation_before_authorization',
      ],
      [
        'policy_deadlines_and_expiring_credit',
        'remaining_services_and_connections',
        'refund_traceability',
      ],
    );
  }
  if (brief.request === 'group' && brief.groupMode === null) {
    add(
      ['groupMode'],
      'Você quer planejar uma nova viagem de grupo ou somente ratear despesas existentes?',
      'Do you want to plan a new group trip or only split existing expenses?',
    );
    return result(
      'needs_group_mode',
      'group_scope_selection',
      ['group-split'],
      ['confirm_scope_before_research_or_allocation', 'keep_households_and_beneficiaries_distinct'],
      ['unnecessary_replanning', 'unaccepted_split_rules'],
    );
  }
  if (['group', 'corporate'].includes(brief.request) && brief.groupMode === 'expenses_only') {
    if (brief.party.households === null)
      add(
        ['party.households'],
        'Quantos núcleos ou centros de custo participarão do rateio?',
        'How many households or cost centers share these expenses?',
      );
    return result(
      questions.length ? 'needs_allocation_context' : 'ready_for_expense_evidence',
      'expense_allocation',
      [],
      [
        'collect_expenses_beneficiaries_and_accepted_split_rule',
        'keep_currencies_expenses_cash_and_credit_separate',
        'reconcile_total_and_per_household_costs',
        'obtain_acceptance_of_the_allocation_rule',
      ],
      ['duplicate_charges', 'deposits_and_card_holds', 'unknown_beneficiaries_or_weights'],
    );
  }
  const requestWorkflows: Partial<Record<Brief['request'], string>> = {
    organize: 'organize-documents',
    itinerary: 'build-itinerary',
    documents: 'travel-documents',
    insurance: 'insurance-review',
    health: 'health-plan',
    accessibility: 'accessibility-plan',
    points: 'points-strategy',
    rights: 'consumer-rights',
    evidence: 'organize-documents',
    risk: 'manage-risk',
    calendar: 'calendar-plan',
    monitor: 'monitor-trip',
    resume: 'resume-trip',
    deliver: 'deliver-trip',
    audit: 'audit-logistics',
    ecosystem: 'ecosystem-setup',
    corporate: 'hybrid-travel',
  };
  const domainWorkflows: Record<Brief['domain'] & string, string> = {
    flight: 'prepurchase-comparison',
    ground: 'ground-transport',
    lodging: 'compare-lodging',
    itinerary: 'build-itinerary',
    documents: 'travel-documents',
    insurance: 'insurance-review',
    health: 'health-plan',
    accessibility: 'accessibility-plan',
    points: 'points-strategy',
    rights: 'consumer-rights',
    evidence: 'organize-documents',
    risk: 'manage-risk',
    group: 'group-split',
    budget: 'total-cost',
    calendar: 'calendar-plan',
    monitoring: 'monitor-trip',
    operations: 'task-board',
    ecosystem: 'ecosystem-setup',
    all: 'trip-intake',
  };
  const selectedWorkflow =
    brief.workflowId ??
    requestWorkflows[brief.request] ??
    (brief.request !== 'group' && brief.domain !== 'flight'
      ? brief.domain
        ? domainWorkflows[brief.domain]
        : 'trip-intake'
      : null);
  if (selectedWorkflow) {
    const selected = getCommand(selectedWorkflow);
    const known = new Set<string>(['trip_scope']);
    if (brief.destination && (!selected.domains.includes('flight') || brief.origin))
      known.add('travel_area');
    if (brief.departureDate && (brief.returnTrip === false || brief.returnDate))
      known.add('date_window');
    const partyCountsKnown = [brief.party.adults, brief.party.children, brief.party.infants].every(
      (value) => value !== null,
    );
    if (partyCountsKnown && brief.mustHaves !== null) known.add('party_profile');
    if (brief.budget?.scope !== null && brief.budget?.scope !== undefined)
      known.add('budget_scope');
    if (brief.mustHaves !== null) known.add('functional_needs');
    if (
      ['serviceKind', 'country', 'kind', 'ongoing', 'occurredAt'].every(
        (field) => brief.incident[field as keyof Brief['incident']] !== null,
      )
    )
      known.add('incident_context');
    const workflow = prepareWorkflow({
      tripKey: brief.tripKey,
      workflowId: selected.id,
      language: brief.language,
      suppliedFields: selected.requiredInputs
        .filter((field) => known.has(field.id))
        .map((field) => field.id),
    });
    const needsDomain =
      !brief.domain && !brief.workflowId && ['plan', 'compare'].includes(brief.request);
    if (needsDomain)
      add(
        ['domain'],
        'O foco é voo, transporte terrestre, hospedagem, roteiro ou outro serviço?',
        'Is the focus a flight, ground transport, lodging, an itinerary or another service?',
      );
    for (const question of workflow.questions) {
      if (question.field === 'party_profile' && partyCountsKnown && brief.mustHaves === null)
        add(
          ['mustHaves'],
          'Quais restrições funcionais devem ser consideradas: acessibilidade, bagagem ou cuidado com dependentes? Informe uma lista vazia somente se nenhuma foi declarada.',
          'Which functional constraints must be considered: accessibility, baggage or dependent care? Supply an empty list only when none were declared.',
        );
      else if (
        question.field === 'budget_scope' &&
        brief.budget !== null &&
        brief.budget.scope === null
      )
        add(
          ['budget.scope'],
          'Quais despesas estão incluídas no orçamento já informado?',
          'Which expenses are included in the budget already supplied?',
        );
      else add([question.field], question.question, question.question);
    }
    return {
      ...result(
        questions.length ? 'needs_critical_information' : workflow.state,
        'catalog_workflow',
        [],
        workflow.nextActions,
        [
          'documented_dependencies_and_plan_b',
          'source_freshness_and_scope',
          'no_assumed_airline_or_supplier_capability',
          ...(brief.party.adults === 0 &&
          (brief.party.children ?? 0) + (brief.party.infants ?? 0) > 0
            ? ['unaccompanied_minor_eligibility_requires_carrier_and_jurisdiction_verification']
            : []),
        ],
      ),
      recommendedWorkflows: [selected.id],
      recommendedAgents: [selected.agentId],
      recommendedTools: [
        'travel_catalog',
        'travel_workflow',
        ...(selected.executor === 'settlement' ? ['travel_settle_expenses'] : []),
      ],
      workflowId: selected.id,
      instructions: workflow.instructions,
      declaredCapabilitiesVerified: false,
    };
  }
  const routeMissing = ['origin', 'destination'].filter(
    (field) => !brief[field as 'origin' | 'destination'],
  );
  if (routeMissing.length)
    add(
      routeMissing,
      'Qual é a origem e o destino desta viagem?',
      'What are the origin and destination of this trip?',
    );
  const datesMissing = [
    ...(!brief.departureDate ? ['departureDate'] : []),
    ...(brief.returnTrip === null ? ['returnTrip'] : []),
    ...(brief.returnTrip === true && !brief.returnDate ? ['returnDate'] : []),
  ];
  if (datesMissing.length)
    add(
      datesMissing,
      'Quais são as datas e haverá retorno? Informe apenas as datas conhecidas.',
      'What are the dates, and is there a return trip? Supply only known dates.',
    );
  const partyMissing = ['adults', 'children', 'infants'].filter(
    (field) => brief.party[field as 'adults' | 'children' | 'infants'] === null,
  );
  if (partyMissing.length)
    add(
      partyMissing.map((field) => `party.${field}`),
      'Quantos adultos, crianças e bebês viajarão? Não informe nomes ou documentos.',
      'How many adults, children and infants are traveling? Do not supply names or identity documents.',
    );
  if (
    (brief.request === 'group' || brief.request === 'corporate') &&
    brief.party.households === null
  )
    add(
      ['party.households'],
      'Quantos núcleos ou centros de custo participarão do rateio?',
      'How many households or cost centers will share expenses?',
    );
  if (brief.mustHaves === null)
    add(
      ['mustHaves'],
      'Há necessidades de acessibilidade, bagagem, criança ou cancelamento flexível?',
      'Are there accessibility, baggage, child-safety or flexible-cancellation requirements?',
    );
  const commands =
    brief.request === 'group'
      ? [
          'group-split',
          ...(brief.domain === 'flight' ? ['total-cost', 'connections', 'flex-dates'] : []),
        ]
      : brief.request === 'corporate'
        ? ['connections', 'total-cost', 'negotiation', 'group-split']
        : ['flex-dates', 'airports', 'connections', 'promotions', 'total-cost'];
  return {
    tripKey: brief.tripKey,
    state: questions.length ? 'needs_critical_information' : 'ready_for_evidence_collection',
    brief,
    questions: questions.slice(0, 5),
    recommendedCommands: commands,
    recommendedWorkflows: commands,
    recommendedAgents: [...new Set(commands.map((id) => getCommand(id).agentId))],
    recommendedTools: ['travel_schema', 'travel_plan'],
    genericWorkflow: 'trip_planning',
    unknowns: [
      ...new Set([
        ...questions.flatMap((question) => question.fields),
        ...(brief.budget === null ? ['budget'] : []),
      ]),
    ],
    nextActions: [
      'keep_this_trip_separate',
      'collect_current_sources_with_host_authorized_tools',
      'compare_total_cost_and_equivalent_conditions',
      'check_connections_documents_deadlines_and_backup_options',
      'ask_for_explicit_authorization_before_any_external_commitment',
    ],
    anticipatoryChecks: [
      'timezone_and_airport_terminal_changes',
      'protected_vs_separate_tickets',
      'baggage_and_ground_transfer_costs',
      'overnight_and_checkin_gaps',
      'cancellation_and_refund_deadlines',
      'accessibility_and_child_safety',
      'weather_seasonality_and_plan_b',
      ...(brief.party.adults === 0 && (brief.party.children ?? 0) + (brief.party.infants ?? 0) > 0
        ? ['unaccompanied_minor_eligibility_requires_carrier_and_jurisdiction_verification']
        : []),
    ],
    limits: [
      'no_live_inventory_or_supplier_confirmation',
      'unknown_is_not_zero_or_false',
      'no_prediction_guarantee',
      'no_booking_payment_or_message_execution',
      'no_model_provider_calls_or_local_persistence',
    ],
  };
}
