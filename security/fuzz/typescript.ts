/** Deterministic mutation/property campaign in disposable bounded Node workers. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resolve, dirname, relative } from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { addMinor } from '../../api/src/money.js';
import { allocate, plan } from '../../api/src/planning.js';
import { literalFacts } from '../../api/src/literal-facts.js';
import { extractText } from '../../api/src/ingestion.js';
import { instant, validateTrip } from '../../api/src/validation.js';
import { validateSuggestions } from '../../api/src/llm.js';
import { AppError } from '../../api/src/errors.js';
import { planningExamples } from '../../web/src/planning-examples.js';
import {
  catalog,
  domainIds,
  phaseIds,
  capabilityIds,
  listCatalog,
  validateCatalog,
} from '../../agent/catalog.js';
import { prepareBrief } from '../../agent/brief.js';
import { prepareWorkflow } from '../../agent/workflow.js';
import { settleExpenses } from '../../agent/expenses.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const script = fileURLToPath(import.meta.url);
const targets = [
  'money',
  'allocation',
  'literal',
  'text',
  'trip',
  'planning',
  'llm',
  'time',
  'deep',
  'agent-catalog',
  'agent-brief',
  'agent-workflow',
  'agent-expenses',
] as const;
type Target = (typeof targets)[number];
type Case = { id: number; target: Target; seed: number; variant: number };
type Outcome = 'accepted' | 'rejected';
type Result = {
  phase: 'start' | 'done';
  id: number;
  target: Target;
  outcome?: string;
  code?: string;
  seconds?: number;
};
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}
function ensure(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error('FUZZ_' + code);
}
function nested(depth: number) {
  let value: unknown = null;
  for (let index = 0; index < depth; index++) value = { synthetic: value };
  return value;
}
function finiteOutput(value: unknown) {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length) {
    ensure(++visited <= 100000, 'OUTPUT_COMPLEXITY');
    const node = pending.pop();
    if (typeof node === 'number') ensure(Number.isFinite(node), 'NONFINITE_OUTPUT');
    else if (node && typeof node === 'object') pending.push(...Object.values(node));
  }
}
function mutation(input: unknown, next: () => number): unknown {
  const values: unknown[] = [
    null,
    false,
    true,
    '',
    -1,
    0,
    1,
    Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER + 1,
    [],
    {},
    '2030-02-30',
    'not-a-zone',
    '\u0000',
    'Synthetic input',
  ];
  if (!input || typeof input !== 'object' || next() < 0.12)
    return values[Math.floor(next() * values.length)];
  const object = input as Record<string, unknown>;
  const keys = Object.keys(object);
  if (!keys.length || next() < 0.2) object.syntheticUnknown = nested(1 + Math.floor(next() * 1000));
  else {
    const key = keys[Math.floor(next() * keys.length)]!;
    object[key] =
      next() < 0.5 ? mutation(object[key], next) : values[Math.floor(next() * values.length)];
  }
  return object;
}
const snippet = { line: 1, text: 'Cancellation: Synthetic non-refundable terms.' };
const tripFixture: unknown = JSON.parse(
  readFileSync(resolve(root, 'examples/trip-contract.json'), 'utf8'),
);

const fixedNow = Date.parse('2030-01-01T12:00:00Z');
const futureTime = '2030-01-01T12:25:00Z';
const pastTime = '2030-01-01T11:59:00Z';
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Only the specified application rejection is expected; arbitrary throws are findings. */
function rejected(run: () => unknown, allowedCodes: readonly string[]): Outcome {
  try {
    run();
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    ensure(allowedCodes.includes(error.code), 'UNEXPECTED_REJECTION_CODE');
    return 'rejected';
  }
  throw new Error('FUZZ_INVALID_INPUT_ACCEPTED');
}

/** Passive data only: no injected functions, accessors, eval or instruction execution. */
function invalidShape(base: object, variant: number, required: string): unknown {
  switch (variant % 8) {
    case 0:
      return null;
    case 1:
      return [base];
    case 2:
      return 'SRC01';
    case 3:
      return { ...base, syntheticUnknown: nested(25 + (variant % 50)) };
    case 4:
      return { ...base, ...JSON.parse('{"__proto__":{"fuzz_canary":"SRC01"}}') };
    case 5: {
      const result = { ...base } as Record<string, unknown>;
      delete result[required];
      return result;
    }
    case 6:
      return { ...base, constructor: { prototype: { fuzz_canary: 'SRC01' } } };
    default:
      return { ...base, [required]: false };
  }
}

function exerciseCatalog(item: Case): Outcome {
  const next = random(item.seed);
  const variant = item.variant % 24;
  if (variant < 8) {
    const query = {
      kind: variant % 2 ? ('agents' as const) : ('workflows' as const),
      ...(variant % 3 ? { domain: domainIds[Math.floor(next() * domainIds.length)]! } : {}),
      ...(variant % 4 ? { phase: phaseIds[Math.floor(next() * phaseIds.length)]! } : {}),
      cursor: Math.floor(next() * 101),
      limit: 1 + Math.floor(next() * 20),
    };
    const result = listCatalog(query);
    const applicable = catalog.commands.filter(
      (command) =>
        (!query.domain ||
          command.domains.some((domain) => domain === query.domain || domain === 'all')) &&
        (!query.phase || command.phases.includes(query.phase)),
    );
    const expected =
      query.kind === 'agents'
        ? catalog.agents.filter(
            (agent) =>
              (!query.domain && !query.phase) ||
              applicable.some((command) => command.agentId === agent.id),
          )
        : applicable;
    ensure(result.total === expected.length, 'CATALOG_TOTAL');
    ensure(
      same(
        result.items.map((row) => row.id),
        expected.slice(query.cursor, query.cursor + query.limit).map((row) => row.id),
      ),
      'CATALOG_FILTER_OR_PAGINATION',
    );
    ensure(
      result.items.length <= query.limit &&
        new Set(result.items.map((row) => row.id)).size === result.items.length,
      'CATALOG_ITEMS',
    );
    ensure(
      result.nextCursor ===
        (query.cursor + query.limit < expected.length ? query.cursor + query.limit : null),
      'CATALOG_CURSOR',
    );
    ensure(
      result.items.every(
        (row) =>
          row.resourceUri === `travel://${query.kind === 'agents' ? 'agent' : 'prompt'}/${row.id}`,
      ),
      'CATALOG_RESOURCE',
    );
    ensure(same(result, listCatalog(query)), 'CATALOG_NONDETERMINISM');
    finiteOutput(result);
    return 'accepted';
  }
  if (variant < 10) {
    const input = structuredClone(catalog);
    if (variant === 9) {
      input.agents.reverse();
      input.commands.reverse();
    }
    const result = validateCatalog(input);
    ensure(
      result.agents.length === catalog.agents.length &&
        result.commands.length === catalog.commands.length,
      'CATALOG_VALID_MANIFEST',
    );
    return 'accepted';
  }
  if (variant < 18) {
    const queries: unknown[] = [
      null,
      [],
      { kind: '__proto__' },
      { domain: '__proto__' },
      { phase: null },
      { limit: item.variant % 2 ? 0 : 21 },
      { cursor: next() < 0.5 ? -1 : 0.5 },
      { ...JSON.parse('{"__proto__":{"fuzz_canary":"SRC01"}}'), syntheticUnknown: nested(40) },
    ];
    return rejected(() => listCatalog(queries[variant - 10]), ['INVALID_CATALOG_QUERY']);
  }
  const input = structuredClone(catalog);
  if (variant === 18)
    return rejected(
      () => validateCatalog(invalidShape(input, item.seed, 'commands')),
      ['INVALID_AGENT_CATALOG'],
    );
  if (variant === 19) {
    input.commands[1]!.id = input.commands[0]!.id;
    return rejected(() => validateCatalog(input), ['DUPLICATE_CATALOG_ENTRY']);
  }
  if (variant === 20) input.commands[0]!.agentId = 'synthetic-unknown';
  if (variant === 21)
    input.commands[0]!.requiredInputs.push({
      ...input.commands[0]!.requiredInputs[0]!,
      pt: 'SRC01',
      en: 'SRC01',
    });
  if (variant === 22)
    input.commands[0]!.executor = input.commands[0]!.calculatorId ? null : 'planning';
  if (variant === 23) {
    input.agents = input.agents.filter((agent) => agent.path !== input.entrypoint);
    return rejected(() => validateCatalog(input), ['MISSING_CATALOG_ENTRYPOINT']);
  }
  return rejected(() => validateCatalog(input), ['INCONSISTENT_CATALOG_REFERENCE']);
}

const domainRoutes: Record<(typeof domainIds)[number], string | null> = {
  flight: null,
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
  geography: 'geography-route-check',
  culture: 'history-culture-context',
  business: 'professional-trip-plan',
  rail: 'rail-ferry-cruise-plan',
  water: 'rail-ferry-cruise-plan',
  entry: 'border-entry-plan',
  connectors: 'connect-account-sources',
  all: 'trip-intake',
};

function checkedBrief(input: unknown) {
  const snapshot = structuredClone(input);
  try {
    return prepareBrief(input);
  } finally {
    ensure(isDeepStrictEqual(input, snapshot), 'BRIEF_INPUT_MUTATED');
  }
}

function exerciseBrief(item: Case): Outcome {
  const variant = item.variant % 32;
  const base = { tripKey: 'SRC01', request: 'plan', language: item.variant % 2 ? 'pt-BR' : 'en' };
  if (variant >= 16 && variant <= 19) {
    const invalidScopes: unknown[] = [
      [false, 0, []][item.seed % 3],
      item.seed % 2 ? '' : 'S'.repeat(121),
      { syntheticUnknown: nested(25) },
      JSON.parse('{"__proto__":{"fuzz_canary":"SRC01"}}'),
    ];
    return rejected(
      () =>
        checkedBrief({
          ...base,
          budget: { minorUnits: 0, currency: 'BRL', scope: invalidScopes[variant - 16] },
        }),
      ['INVALID_AGENT_BRIEF'],
    );
  }
  if (variant >= 20) {
    let input: unknown = base;
    if (variant < 28) input = invalidShape(base, variant - 20, 'tripKey');
    if (variant === 28) input = { ...base, domain: '__proto__' };
    if (variant === 29)
      input = { ...base, budget: { minorUnits: -1 - (item.variant % 100), currency: 'BRL' } };
    if (variant === 30)
      input = { ...base, budget: { minorUnits: Number.MAX_SAFE_INTEGER + 1, currency: 'BRL' } };
    if (variant === 31)
      input = { ...base, departureDate: '2030-01-02', returnDate: '2030-01-01', returnTrip: true };
    return rejected(
      () => checkedBrief(input),
      [variant === 31 ? 'CONFLICTING_TRIP_DATES' : 'INVALID_AGENT_BRIEF'],
    );
  }
  const domain = domainIds[(item.seed >>> 0) % domainIds.length]!;
  const command = catalog.commands[(item.seed >>> 0) % catalog.commands.length]!;
  let input: Record<string, unknown> = { ...base, domain };
  if (variant === 0) input = { ...base };
  if (variant === 1) input = { ...base, domain: null, party: null, budget: null, mustHaves: null };
  if (variant === 2) input = { ...base, workflowId: command.id };
  if (variant === 3) input = { ...base, request: 'group' };
  if (variant === 4 || variant === 5)
    input = {
      ...base,
      request: variant === 4 ? 'group' : 'corporate',
      groupMode: 'expenses_only',
      party: { households: 2 },
    };
  if (variant === 6 || variant === 7)
    input = {
      ...base,
      domain: 'flight',
      origin: 'SRC02',
      destination: 'SRC03',
      departureDate: '2030-02-01',
      returnTrip: false,
      party: { adults: 1, children: 0, infants: 0 },
      mustHaves: [],
      budget: variant === 6 ? { minorUnits: 0, currency: 'BRL' } : null,
    };
  if (variant === 8 || variant === 9 || variant === 10)
    input = {
      ...base,
      request: variant === 8 ? 'disruption' : variant === 9 ? 'cancel' : 'change',
      incident: {
        serviceKind: variant === 8 ? 'flight' : 'bus',
        country: null,
        kind: null,
        ongoing: false,
        occurredAt: null,
        scheduledAt: null,
      },
    };
  if (variant >= 11 && variant <= 15)
    input.budget = {
      minorUnits: variant === 14 ? 0 : variant === 15 ? 9000000000000 : item.seed % 1000001,
      currency: 'BRL',
      ...(variant === 11 || variant === 14 || variant === 15
        ? { scope: variant === 15 ? 'SRC04 SRC05' : 'SRC04' }
        : variant === 12
          ? { scope: null }
          : {}),
    };
  const result = checkedBrief(input);
  ensure(same(result, checkedBrief(input)), 'BRIEF_NONDETERMINISM');
  ensure(
    result.questions.length <= 5 && new Set(result.unknowns).size === result.unknowns.length,
    'BRIEF_QUESTION_BOUND',
  );
  ensure(
    result.recommendedWorkflows.every((id) => catalog.commands.some((row) => row.id === id)),
    'BRIEF_UNKNOWN_WORKFLOW',
  );
  ensure(
    result.recommendedAgents.every((id) => catalog.agents.some((row) => row.id === id)),
    'BRIEF_UNKNOWN_AGENT',
  );
  ensure(
    result.limits.includes('no_booking_payment_or_message_execution') &&
      result.limits.includes('no_model_provider_calls_or_local_persistence'),
    'BRIEF_EFFECT_CLAIM',
  );
  ensure(
    !('declaredCapabilitiesVerified' in result) || result.declaredCapabilitiesVerified === false,
    'BRIEF_VERIFIED_CLAIM',
  );
  if (input.budget === null || input.budget === undefined) {
    ensure(result.brief.budget === null, 'BRIEF_UNKNOWN_BUDGET_COERCED');
  } else {
    const suppliedBudget = input.budget as {
      minorUnits: number;
      currency: string;
      scope?: string | null;
    };
    ensure(
      result.brief.budget !== null &&
        result.brief.budget.minorUnits === suppliedBudget.minorUnits &&
        result.brief.budget.currency === suppliedBudget.currency,
      'BRIEF_BUDGET_INVENTED',
    );
    ensure(
      result.brief.budget.scope === (suppliedBudget.scope ?? null),
      'BRIEF_BUDGET_SCOPE_INVENTED',
    );
    ensure(
      same(Object.keys(result.brief.budget).sort(), ['currency', 'minorUnits', 'scope']),
      'BRIEF_BUDGET_SHAPE',
    );
  }
  if (variant === 0) ensure(result.unknowns.includes('domain'), 'BRIEF_MISSING_DOMAIN');
  if (variant === 1)
    ensure(
      result.brief.party.adults === null &&
        result.brief.returnTrip === null &&
        result.brief.mustHaves === null,
      'BRIEF_NULL_COERCION',
    );
  if (variant === 2)
    ensure(same(result.recommendedWorkflows, [command.id]), 'BRIEF_EXPLICIT_ROUTE');
  if (variant === 3) ensure(result.state === 'needs_group_mode', 'BRIEF_GROUP_SCOPE');
  if (variant === 4 || variant === 5)
    ensure(
      result.genericWorkflow === 'expense_allocation' &&
        same(result.recommendedWorkflows, ['expense-settlement']),
      'BRIEF_EXPENSE_ROUTE',
    );
  if (variant === 6)
    ensure(
      result.brief.budget?.minorUnits === 0 && !result.unknowns.includes('budget'),
      'BRIEF_ZERO_BUDGET',
    );
  if (variant === 7) ensure(result.unknowns.includes('budget'), 'BRIEF_UNKNOWN_BUDGET');
  if (variant === 8)
    ensure(
      result.genericWorkflow === 'incident_response' && result.brief.incident.ongoing === false,
      'BRIEF_INCIDENT_TRIAGE',
    );
  if (variant === 9 || variant === 10)
    ensure(
      result.genericWorkflow === 'service_change_or_refund' &&
        result.brief.incident.scheduledAt === null,
      'BRIEF_REFUND_INVENTED',
    );
  if (variant >= 11 && domainRoutes[domain])
    ensure(same(result.recommendedWorkflows, [domainRoutes[domain]]), 'BRIEF_DOMAIN_ROUTE');
  finiteOutput(result);
  return 'accepted';
}

type WorkflowFixture = {
  tripKey: string;
  workflowId: string;
  language: 'pt-BR' | 'en';
  suppliedFields?: string[];
  sourceRefs?: string[];
  capabilities?: (typeof capabilityIds)[number][];
  budget?: {
    maxToolCalls?: number;
    maxRetries?: number;
    maxDelegations?: number;
    deadlineAt?: string;
  };
  checkpoint?: {
    version: 1;
    tripKey: string;
    workflowId: string;
    suppliedFields: string[];
    sourceRefs: string[];
    remainingToolCalls: number;
    sameFailureCount: number;
    expiresAt: string;
    deadlineAt?: string;
  };
};

function exerciseWorkflow(item: Case): Outcome {
  const variant = item.variant % 36;
  const command = catalog.commands[(item.seed >>> 0) % catalog.commands.length]!;
  const fields = command.requiredInputs.map((row) => row.id);
  const base: WorkflowFixture = {
    tripKey: 'SRC01',
    workflowId: command.id,
    language: item.variant % 2 ? 'pt-BR' : 'en',
    suppliedFields: [],
    sourceRefs: ['SRC01'],
    capabilities: [],
    budget: {
      maxToolCalls: 2 + (item.seed % 29),
      maxRetries: 1,
      maxDelegations: 0,
      deadlineAt: futureTime,
    },
  };
  if (variant >= 24) {
    if (variant < 32)
      return rejected(
        () => prepareWorkflow(invalidShape(base, variant - 24, 'tripKey'), fixedNow),
        ['INVALID_WORKFLOW_INPUT'],
      );
    if (variant === 32)
      return rejected(
        () => prepareWorkflow({ ...base, now: pastTime }, fixedNow),
        ['INVALID_WORKFLOW_INPUT'],
      );
    if (variant === 33)
      return rejected(
        () =>
          prepareWorkflow(
            {
              ...base,
              sourceRefs: Array.from({ length: 33 }, (_, i) => `SRC${String(i).padStart(2, '0')}`),
            },
            fixedNow,
          ),
        ['INVALID_WORKFLOW_INPUT'],
      );
    if (variant === 34)
      return rejected(
        () => prepareWorkflow({ ...base, suppliedFields: ['synthetic_unknown'] }, fixedNow),
        ['WORKFLOW_FIELD_NOT_APPLICABLE'],
      );
    return rejected(
      () => prepareWorkflow(base, [NaN, -1, Number.MAX_SAFE_INTEGER][item.seed % 3]!),
      ['WORKFLOW_CLOCK_UNAVAILABLE'],
    );
  }
  const input = structuredClone(base);
  if (variant === 1 || variant === 2) input.suppliedFields = [...fields];
  if (variant === 1) input.capabilities = [...capabilityIds];
  if (variant === 3) input.budget!.maxToolCalls = 0;
  if (variant === 4) input.budget!.maxToolCalls = 1;
  if (variant === 5) input.budget!.deadlineAt = pastTime;
  if (variant >= 6) {
    input.checkpoint = {
      version: 1,
      tripKey: input.tripKey,
      workflowId: input.workflowId,
      suppliedFields: [...fields],
      sourceRefs: ['SRC02'],
      remainingToolCalls: item.seed % 31,
      sameFailureCount: 0,
      expiresAt: futureTime,
      deadlineAt: futureTime,
    };
    if (variant === 6) input.checkpoint.remainingToolCalls = 0;
    if (variant === 7) input.checkpoint.sameFailureCount = 3;
    if (variant === 8) {
      input.checkpoint.sameFailureCount = 1;
      input.budget!.maxRetries = 0;
    }
    if (variant >= 9 && variant <= 13)
      input.checkpoint.expiresAt = variant === 9 ? '2030-01-01T12:00:00Z' : pastTime;
    if (variant === 10) input.checkpoint.remainingToolCalls = 0;
    if (variant === 11) input.checkpoint.sameFailureCount = 3;
    if (variant === 12) input.suppliedFields = fields.slice(0, 1);
    if (variant === 13) delete input.checkpoint.deadlineAt;
    if (variant === 14) input.checkpoint.deadlineAt = pastTime;
    if (variant === 15) input.checkpoint.deadlineAt = '2030-01-01T12:05:00Z';
    if (variant === 16) delete input.checkpoint.deadlineAt;
    if (variant === 17) input.budget!.maxToolCalls = 0;
    if (variant === 18) input.checkpoint.tripKey = 'SRC99';
    if (variant === 19)
      input.checkpoint.workflowId = catalog.commands.find((row) => row.id !== command.id)!.id;
    if (variant === 20) input.checkpoint.expiresAt = '2030-01-01T12:30:00';
    if (variant === 21) input.checkpoint.sourceRefs = ['__proto__'];
    if (variant === 22) input.checkpoint.remainingToolCalls = -1;
    if (variant === 23) input.checkpoint.suppliedFields = ['synthetic_unknown'];
  }
  if (variant === 18 || variant === 19)
    return rejected(() => prepareWorkflow(input, fixedNow), ['WORKFLOW_CHECKPOINT_MISMATCH']);
  if (variant >= 20 && variant <= 22)
    return rejected(() => prepareWorkflow(input, fixedNow), ['INVALID_WORKFLOW_INPUT']);
  if (variant === 23)
    return rejected(() => prepareWorkflow(input, fixedNow), ['WORKFLOW_FIELD_NOT_APPLICABLE']);

  const output = prepareWorkflow(input, fixedNow);
  ensure(same(output, prepareWorkflow(input, fixedNow)), 'WORKFLOW_NONDETERMINISM');
  ensure(
    output.effects.externalCalls === 0 &&
      output.effects.modelCalls === 0 &&
      output.effects.persistenceWrites === 0 &&
      output.effects.permissionsGranted === false,
    'WORKFLOW_EXTERNAL_EFFECT',
  );
  ensure(
    output.capabilities.verifiedByTool === false &&
      output.capabilities.permissionsGranted === false,
    'WORKFLOW_CAPABILITY_CLAIM',
  );
  ensure(
    output.checklist.every((row) => row.status === 'not_performed'),
    'WORKFLOW_UNPERFORMED_CLAIM',
  );
  const previous = Math.min(
    input.budget?.maxToolCalls ?? 8,
    input.checkpoint?.remainingToolCalls ?? 30,
  );
  const deadline = Math.min(
    Date.parse(input.budget?.deadlineAt ?? '2030-01-01T12:30:00Z'),
    input.checkpoint?.deadlineAt ? Date.parse(input.checkpoint.deadlineAt) : Infinity,
  );
  ensure(
    output.budget.previousRemainingToolCalls === previous && output.budget.remainingToolCalls >= 0,
    'WORKFLOW_COUNTER_INCREASE',
  );
  ensure(
    output.budget.remainingToolCalls === previous - output.budget.preparationCallsDebited &&
      [0, 1].includes(output.budget.preparationCallsDebited),
    'WORKFLOW_COUNTER_DEBIT',
  );
  ensure(
    Date.parse(output.budget.deadlineAt) === deadline &&
      Date.parse(output.checkpoint.expiresAt) <= Math.min(fixedNow + 1800000, deadline),
    'WORKFLOW_DEADLINE_EXTENDED',
  );
  const expired = !!input.checkpoint && Date.parse(input.checkpoint.expiresAt) <= fixedNow;
  const known = [
    ...new Set([
      ...(input.suppliedFields ?? []),
      ...(!expired ? (input.checkpoint?.suppliedFields ?? []) : []),
    ]),
  ].sort();
  const refs = [
    ...new Set([
      ...(input.sourceRefs ?? []),
      ...(!expired ? (input.checkpoint?.sourceRefs ?? []) : []),
    ]),
  ].sort();
  ensure(
    same(output.suppliedFields, known) && same(output.checkpoint.sourceRefs, refs),
    'WORKFLOW_STALE_DATA_RESTORED',
  );
  ensure(
    same(
      output.missingFields,
      fields.filter((field) => !known.includes(field)),
    ),
    'WORKFLOW_UNKNOWN_FIELDS',
  );
  ensure(output.freshVerificationNeeded === expired, 'WORKFLOW_EXPIRY_STATE');
  if (expired)
    ensure(
      output.checkpointStatus === 'expired_fields_discarded' &&
        same(output.discardedCheckpointFields, [...input.checkpoint!.suppliedFields].sort()),
      'WORKFLOW_EXPIRY_DISCARD',
    );
  if (input.checkpoint && !expired)
    ensure(
      Date.parse(output.checkpoint.expiresAt) <= Date.parse(input.checkpoint.expiresAt),
      'WORKFLOW_CHECKPOINT_EXTENDED',
    );
  const failures = input.checkpoint?.sameFailureCount ?? 0;
  const preStop =
    deadline <= fixedNow
      ? 'deadline'
      : previous === 0
        ? 'budget'
        : failures >= 3
          ? 'repeated_failure'
          : failures > (input.budget?.maxRetries ?? 1)
            ? 'retry_budget'
            : null;
  const expectedStop = preStop ?? (previous === 1 ? 'budget' : null);
  ensure(
    output.stopReason === expectedStop &&
      output.budget.preparationCallsDebited === (preStop ? 0 : 1),
    'WORKFLOW_STOP_PRECEDENCE',
  );
  if (expectedStop)
    ensure(
      output.state === `stopped_${expectedStop}` &&
        output.questions.length === 0 &&
        output.nextActions.length === 1,
      'WORKFLOW_PROGRESS_AFTER_STOP',
    );
  else if (expired) ensure(output.state === 'needs_fresh_verification', 'WORKFLOW_EXPIRED_READY');
  else if (known.length < fields.length)
    ensure(output.state === 'needs_critical_information', 'WORKFLOW_MISSING_READY');
  else if (
    command.suggestedCapabilities.some((capability) => !input.capabilities?.includes(capability))
  )
    ensure(output.state === 'capability_limited', 'WORKFLOW_UNDECLARED_READY');
  else ensure(output.state === 'ready_for_documentary_review', 'WORKFLOW_DOCUMENTARY_STATE');
  ensure(output.questions.length <= 5, 'WORKFLOW_QUESTION_BOUND');
  finiteOutput(output);
  return 'accepted';
}

type ExpenseFixture = {
  tripKey: string;
  currency: string;
  acceptedRule: true;
  households: string[];
  expenses: Array<{
    id: string;
    amountMinor: number;
    paidBy: string;
    beneficiaries: Array<{ householdId: string; weight: number }>;
  }>;
  priorSettlements: Array<{ id: string; from: string; to: string; amountMinor: number }>;
};

function expenseOracle(input: ExpenseFixture) {
  const accounts = new Map(
    input.households.map((id) => [id, { paid: 0n, share: 0n, sent: 0n, received: 0n }]),
  );
  let total = 0n;
  for (const expense of input.expenses) {
    const amount = BigInt(expense.amountMinor);
    total += amount;
    accounts.get(expense.paidBy)!.paid += amount;
    const denominator = expense.beneficiaries.reduce((sum, row) => sum + BigInt(row.weight), 0n);
    const rows = expense.beneficiaries.map((row) => ({
      id: row.householdId,
      numerator: amount * BigInt(row.weight),
    }));
    const leftover = amount - rows.reduce((sum, row) => sum + row.numerator / denominator, 0n);
    // Independent O(n²) ranking oracle: do not call the implementation's allocator or sort its remainders.
    for (const row of rows) {
      const remainder = row.numerator % denominator;
      const rank = rows.filter(
        (other) =>
          other.numerator % denominator > remainder ||
          (other.numerator % denominator === remainder && other.id < row.id),
      ).length;
      accounts.get(row.id)!.share +=
        row.numerator / denominator + (BigInt(rank) < leftover ? 1n : 0n);
    }
  }
  let priorTotal = 0n;
  for (const prior of input.priorSettlements) {
    const amount = BigInt(prior.amountMinor);
    priorTotal += amount;
    accounts.get(prior.from)!.sent += amount;
    accounts.get(prior.to)!.received += amount;
  }
  return { accounts, total, priorTotal };
}

function exerciseExpenses(item: Case): Outcome {
  const next = random(item.seed);
  const variant = item.variant % 50;
  const ids = Array.from(
    { length: 2 + (item.seed % 5) },
    (_, i) => `N${String(i + 1).padStart(2, '0')}`,
  );
  let input: ExpenseFixture = {
    tripKey: 'SRC01',
    currency: ['BRL', 'USD', 'JPY', 'KWD'][item.seed % 4]!,
    acceptedRule: true,
    households: ids,
    expenses: Array.from({ length: 2 + (item.seed % 7) }, (_, i) => ({
      id: `E${String(i + 1).padStart(2, '0')}`,
      amountMinor: Math.floor(next() * 1000001),
      paidBy: ids[Math.floor(next() * ids.length)]!,
      beneficiaries: ids
        .filter((_, j) => j === 0 || next() < 0.7)
        .map((householdId) => ({ householdId, weight: 1 + Math.floor(next() * 1000000) })),
    })),
    priorSettlements: [],
  };
  if (variant >= 19) {
    if (variant < 27)
      return rejected(
        () => settleExpenses(invalidShape(input, variant - 19, 'expenses')),
        ['INVALID_EXPENSE_INPUT'],
      );
    if (variant === 27)
      return rejected(
        () => settleExpenses({ ...input, acceptedRule: false }),
        ['INVALID_EXPENSE_INPUT'],
      );
    if (variant >= 28 && variant <= 31) {
      const amounts = [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, null];
      return rejected(
        () =>
          settleExpenses({
            ...input,
            expenses: [{ ...input.expenses[0]!, amountMinor: amounts[variant - 28] }],
          }),
        ['INVALID_EXPENSE_INPUT'],
      );
    }
    if (variant === 32)
      input.expenses[0]!.beneficiaries[0]!.weight = [0, 0.5, 1000001][item.seed % 3]!;
    if (variant === 33) input.expenses[0]!.paidBy = 'N99';
    if (variant === 34) input.expenses[1]!.id = input.expenses[0]!.id;
    if (variant === 35)
      input.expenses[0]!.beneficiaries.push(structuredClone(input.expenses[0]!.beneficiaries[0]!));
    if (variant === 36)
      input.expenses = [Number.MAX_SAFE_INTEGER, 1].map((amountMinor, i) => ({
        id: `E0${i + 1}`,
        amountMinor,
        paidBy: ids[0]!,
        beneficiaries: [{ householdId: ids[0]!, weight: 1 }],
      }));
    if (variant === 37)
      return rejected(
        () => settleExpenses({ ...input, expenses: null }),
        ['INVALID_EXPENSE_INPUT'],
      );
    if (variant >= 38 && variant <= 43)
      input.priorSettlements = [{ id: 'T01', from: ids[1]!, to: ids[0]!, amountMinor: 6000 }];
    if (variant === 38) input.priorSettlements[0]!.to = input.priorSettlements[0]!.from;
    if (variant === 39) input.priorSettlements.push({ ...input.priorSettlements[0]! });
    if (variant === 40) input.priorSettlements[0]!.from = 'N99';
    if (variant === 41)
      input.priorSettlements = [Number.MAX_SAFE_INTEGER, 1].map((amountMinor, i) => ({
        id: `T0${i + 1}`,
        from: ids[1]!,
        to: ids[0]!,
        amountMinor,
      }));
    if (variant === 42) input.priorSettlements[0]!.amountMinor = item.seed % 2 ? -1 : 0.5;
    if (variant === 43) {
      input.expenses = [
        {
          id: 'E01',
          amountMinor: Number.MAX_SAFE_INTEGER,
          paidBy: ids[0]!,
          beneficiaries: [{ householdId: ids[1]!, weight: 1 }],
        },
      ];
      input.priorSettlements = [
        { id: 'T01', from: ids[0]!, to: ids[1]!, amountMinor: Number.MAX_SAFE_INTEGER },
      ];
    }
    if (variant === 44) input.households.push(input.households[0]!);
    if (variant === 45) input.expenses[0]!.id = '__proto__';
    if (variant === 46)
      return rejected(
        () => settleExpenses({ ...input, priorSettlements: null }),
        ['INVALID_EXPENSE_INPUT'],
      );
    if (variant === 47)
      return rejected(
        () => settleExpenses({ ...input, expenses: 'unknown' }),
        ['INVALID_EXPENSE_INPUT'],
      );
    if (variant === 48) {
      const { priorSettlements: _priorSettlements, ...missing } = input;
      return rejected(() => settleExpenses(missing), ['INVALID_EXPENSE_INPUT']);
    }
    if (variant === 49)
      return rejected(
        () =>
          settleExpenses({
            ...input,
            priorSettlements: [{ id: 'T01', from: ids[1]!, to: ids[0]!, amountMinor: null }],
          }),
        ['INVALID_EXPENSE_INPUT'],
      );
    const codes: Record<number, string> = {
      32: 'INVALID_EXPENSE_INPUT',
      33: 'EXPENSE_HOUSEHOLD_REFERENCE',
      34: 'DUPLICATE_EXPENSE_ID',
      35: 'DUPLICATE_BENEFICIARY',
      36: 'EXPENSE_TOTAL_OVERFLOW',
      38: 'PRIOR_SETTLEMENT_SELF_TRANSFER',
      39: 'DUPLICATE_PRIOR_SETTLEMENT_ID',
      40: 'EXPENSE_HOUSEHOLD_REFERENCE',
      41: 'PRIOR_SETTLEMENT_TOTAL_OVERFLOW',
      42: 'INVALID_EXPENSE_INPUT',
      43: 'EXPENSE_BALANCE_OVERFLOW',
      44: 'INVALID_EXPENSE_INPUT',
      45: 'INVALID_EXPENSE_INPUT',
    };
    return rejected(() => settleExpenses(input), [codes[variant]!]);
  }
  if (variant === 0 || variant === 9 || variant === 16 || variant === 17) input.expenses = [];
  if (variant === 1)
    input.expenses.forEach((expense) => {
      expense.amountMinor = 0;
    });
  if (variant === 2 || variant === 15)
    input.expenses = [
      {
        id: 'E01',
        amountMinor: Number.MAX_SAFE_INTEGER,
        paidBy: ids[0]!,
        beneficiaries: ids.map((householdId) => ({
          householdId,
          weight: variant === 15 ? 1000000 : 1,
        })),
      },
    ];
  if (variant === 3) input.currency = 'ZZZ';
  if (variant === 4) {
    input.households = [ids[0]!];
    input.expenses.forEach((expense) => {
      expense.paidBy = ids[0]!;
      expense.beneficiaries = [{ householdId: ids[0]!, weight: 1 }];
    });
  }
  if (variant === 5)
    input.expenses = [
      {
        id: 'E01',
        amountMinor: 1,
        paidBy: ids[0]!,
        beneficiaries: ids.map((householdId) => ({ householdId, weight: 1 })),
      },
    ];
  if ((variant >= 8 && variant <= 14) || variant === 16 || variant === 17)
    input.priorSettlements = [
      {
        id: 'T01',
        from: ids[1]!,
        to: ids[0]!,
        amountMinor: variant === 10 ? 0 : variant >= 16 ? Number.MAX_SAFE_INTEGER : 6000,
      },
    ];
  if (variant === 11)
    input.priorSettlements.push({ id: 'T02', from: ids[0]!, to: ids[1]!, amountMinor: 6000 });
  if (variant === 12 || variant === 13) {
    input.households = ids.slice(0, 2);
    input.expenses = [
      {
        id: 'E01',
        amountMinor: 100,
        paidBy: ids[0]!,
        beneficiaries: input.households.map((householdId) => ({ householdId, weight: 1 })),
      },
    ];
    input.priorSettlements[0]!.amountMinor = variant === 12 ? 50 : 100;
  }
  if (variant === 14)
    input.priorSettlements.push({
      id: 'T02',
      from: ids[0]!,
      to: ids[1]!,
      amountMinor: Math.floor(next() * 100001),
    });
  if (variant === 18) input = Object.assign(Object.create(null) as ExpenseFixture, input);
  const output = settleExpenses(input);
  const oracle = expenseOracle(input);
  ensure(
    Number.isSafeInteger(output.totalExpensesMinor) &&
      BigInt(output.totalExpensesMinor) === oracle.total,
    'EXPENSE_TOTAL_CHANGED',
  );
  ensure(
    output.expenseCount === input.expenses.length &&
      output.priorSettlementCount === input.priorSettlements.length,
    'EXPENSE_COUNT',
  );
  ensure(
    BigInt(output.totalPriorSettlementsMinor) === oracle.priorTotal,
    'EXPENSE_PRIOR_ADDED_TO_SPENDING',
  );
  ensure(
    output.transfersExecuted === false &&
      output.settlementsAreSuggestions === true &&
      output.acceptedRule === 'declared_by_caller_not_independently_verified',
    'EXPENSE_TRANSFER_CLAIM',
  );
  ensure(
    output.priorSettlementsStatus === 'declared_by_caller_not_independently_verified',
    'EXPENSE_PRIOR_VERIFIED',
  );
  ensure(
    output.balances.length === oracle.accounts.size &&
      new Set(output.balances.map((row) => row.householdId)).size === oracle.accounts.size,
    'EXPENSE_ACCOUNT_SET',
  );
  const residual = new Map<string, bigint>();
  for (const row of output.balances) {
    const expected = oracle.accounts.get(row.householdId);
    ensure(expected, 'EXPENSE_UNKNOWN_ACCOUNT');
    ensure(
      [
        row.paidMinor,
        row.shareMinor,
        row.priorSentMinor,
        row.priorReceivedMinor,
        row.balanceMinor,
      ].every(Number.isSafeInteger),
      'EXPENSE_UNSAFE_BALANCE',
    );
    ensure(
      BigInt(row.paidMinor) === expected.paid &&
        BigInt(row.shareMinor) === expected.share &&
        BigInt(row.priorSentMinor) === expected.sent &&
        BigInt(row.priorReceivedMinor) === expected.received,
      'EXPENSE_ALLOCATION_ORACLE',
    );
    const balance = expected.paid - expected.share + expected.sent - expected.received;
    ensure(BigInt(row.balanceMinor) === balance, 'EXPENSE_BALANCE_ORACLE');
    residual.set(row.householdId, balance);
  }
  const sum = (values: Iterable<bigint>) => [...values].reduce((total, value) => total + value, 0n);
  ensure(sum(residual.values()) === 0n, 'EXPENSE_NOT_CONSERVED');
  const positiveTotal = sum([...residual.values()].filter((value) => value > 0n));
  ensure(BigInt(output.totalResidualSettlementMinor) === positiveTotal, 'EXPENSE_RESIDUAL_TOTAL');
  for (const proposed of output.settlements) {
    ensure(
      residual.has(proposed.from) &&
        residual.has(proposed.to) &&
        proposed.from !== proposed.to &&
        Number.isSafeInteger(proposed.amountMinor) &&
        proposed.amountMinor > 0,
      'EXPENSE_INVALID_SUGGESTION',
    );
    const amount = BigInt(proposed.amountMinor),
      from = residual.get(proposed.from)!,
      to = residual.get(proposed.to)!;
    ensure(
      from < 0n && to > 0n && amount <= -from && amount <= to,
      'EXPENSE_SUGGESTION_OVERPAYMENT',
    );
    residual.set(proposed.from, from + amount);
    residual.set(proposed.to, to - amount);
  }
  ensure(
    [...residual.values()].every((value) => value === 0n),
    'EXPENSE_UNSETTLED_RESIDUAL',
  );
  ensure(
    BigInt(output.reconciliation.paidMinor) === oracle.total &&
      BigInt(output.reconciliation.allocatedMinor) === oracle.total &&
      BigInt(output.reconciliation.priorSentMinor) === oracle.priorTotal &&
      BigInt(output.reconciliation.priorReceivedMinor) === oracle.priorTotal &&
      output.reconciliation.balanceMinor === 0,
    'EXPENSE_RECONCILIATION_ORACLE',
  );
  const permuted = structuredClone(input);
  permuted.households.reverse();
  permuted.expenses.reverse();
  permuted.expenses.forEach((expense) => expense.beneficiaries.reverse());
  permuted.priorSettlements.reverse();
  ensure(same(output, settleExpenses(permuted)), 'EXPENSE_PERMUTATION');
  if (variant === 0)
    ensure(
      output.totalExpensesMinor === 0 &&
        output.totalPriorSettlementsMinor === 0 &&
        output.settlements.length === 0,
      'EXPENSE_EXPLICIT_EMPTY',
    );
  if (variant === 12) ensure(output.settlements.length === 0, 'EXPENSE_PRIOR_IGNORED');
  finiteOutput(output);
  return 'accepted';
}

function exercise(item: Case): Outcome | void {
  const next = random(item.seed);
  if (item.target === 'agent-catalog') return exerciseCatalog(item);
  else if (item.target === 'agent-brief') return exerciseBrief(item);
  else if (item.target === 'agent-workflow') return exerciseWorkflow(item);
  else if (item.target === 'agent-expenses') return exerciseExpenses(item);
  else if (item.target === 'money') {
    const edges = [0, 1, -1, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0.1, Infinity, NaN];
    const a =
      item.variant % 3
        ? Math.floor((next() - 0.5) * Number.MAX_SAFE_INTEGER)
        : edges[item.variant % edges.length]!;
    const b =
      item.variant % 2
        ? Math.floor((next() - 0.5) * Number.MAX_SAFE_INTEGER)
        : edges[(item.variant + 3) % edges.length]!;
    const value = addMinor(a, b);
    ensure(
      Number.isSafeInteger(a) && Number.isSafeInteger(b) && Number.isSafeInteger(value),
      'UNSAFE_MONEY_ACCEPTED',
    );
    ensure(BigInt(value) === BigInt(a) + BigInt(b), 'MONEY_ROUNDING');
  } else if (item.target === 'allocation') {
    const amount = item.variant % 4 ? Math.floor(next() * Number.MAX_SAFE_INTEGER) : 0;
    const shares = Array.from({ length: 1 + (item.variant % 8) }, (_, index) => ({
      householdId: index === 0 && item.variant % 7 === 0 ? '__proto__' : 'synthetic-' + index,
      weight: 1 + Math.floor(next() * 1000000),
    }));
    const values = Object.values(allocate(amount, shares));
    ensure(
      values.every((value) => Number.isSafeInteger(value) && value >= 0),
      'INVALID_SHARE',
    );
    ensure(
      values.reduce((total, value) => total + BigInt(value), 0n) === BigInt(amount),
      'ALLOCATION_NOT_CONSERVED',
    );
  } else if (item.target === 'literal') {
    const currencies = ['BRL', 'USD', 'JPY', 'KWD', 'XXX'];
    const data = `Supplier: Synthetic Provider\nDate: ${['2030-02-30', '2030-01-01', '2030-01-01T12:30', '2030-01-01T12:30Z'][item.variant % 4]}\nTotal: ${currencies[item.variant % currencies.length]} ${Math.floor(next() * 9000000)}.${String(item.variant % 100).padStart(2, '0')}`;
    const facts = literalFacts(data);
    ensure(facts.length <= 30, 'FACT_LIMIT');
    for (const fact of facts) {
      ensure(
        fact.state === 'extracted' && data.split('\n')[fact.source.line! - 1] === fact.source.quote,
        'FACT_SOURCE',
      );
      if (typeof fact.value === 'object' && 'minorUnits' in fact.value)
        ensure(
          Number.isSafeInteger(fact.value.minorUnits) &&
            fact.value.minorUnits >= 0 &&
            fact.value.minorUnits <= 9000000000000,
          'FACT_MONEY',
        );
    }
  } else if (item.target === 'text') {
    const bytes = Buffer.from(
      'Booking reference: SYNTHETIC-ONLY\nCancellation: Synthetic literal terms.\n'.repeat(
        1 + (item.variant % 100),
      ),
    );
    for (let index = 0; index < item.variant % 15; index++)
      bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256);
    const result = extractText(bytes);
    ensure(
      result.status === 'needs_review' &&
        result.fields.length <= 300 &&
        (result.snippets?.length ?? 0) <= 50,
      'EXTRACTION_LIMIT',
    );
    ensure(
      result.fields.every(
        (field) => field.state === 'extracted' && field.source.quote.length <= 600,
      ),
      'EXTRACTION_SOURCE',
    );
  } else if (item.target === 'trip') {
    validateTrip(mutation(structuredClone(tripFixture), next));
  } else if (item.target === 'planning') {
    const toolNames = Object.keys(planningExamples);
    const tool = toolNames[item.variant % toolNames.length]! as keyof typeof planningExamples;
    const output = plan(tool, mutation(structuredClone(planningExamples[tool]), next));
    ensure(output.externalCalls === 0 && output.mode === 'documentary', 'EXTERNAL_PLANNING_ACTION');
    finiteOutput(output);
  } else if (item.target === 'llm') {
    const field = {
      path: item.variant % 3 ? 'cancellation.summary' : 'reservation.confirmation',
      value: item.variant % 2 ? snippet.text : 'Synthetic invented value',
      quote: snippet.text,
    };
    const input = item.variant % 5 ? { fields: [field] } : { fields: [field], tool_calls: [] };
    const fields = validateSuggestions(input, [snippet]);
    ensure(
      fields.every(
        (value) =>
          value.state === 'extracted' &&
          value.value === snippet.text &&
          value.source.quote === snippet.text,
      ),
      'LLM_INVENTED_FACT',
    );
  } else if (item.target === 'time') {
    const value = instant({
      local: ['2030-01-01T12:00', '2030-02-30T99:99', '2026-03-08T02:30', '2026-11-01T01:30', ''][
        item.variant % 5
      ]!,
      timeZone: [null, 'UTC', 'America/New_York', 'Synthetic/Unknown'][item.variant % 4]!,
    });
    ensure(value === null || Number.isSafeInteger(value), 'TIME_NONFINITE');
  } else if (item.variant % 5 === 0) {
    try {
      const output = plan('total-cost', structuredClone(planningExamples['total-cost']));
      ensure(output.externalCalls === 0 && output.mode === 'documentary', 'DEPTH_BASELINE_EFFECT');
      finiteOutput(output);
    } catch (error) {
      if (error instanceof AppError) throw new Error('FUZZ_VALID_DEPTH_BASELINE_REJECTED');
      throw error;
    }
  } else {
    const value = nested(100 + (item.variant % 3000));
    const tool = ['total-cost', '__proto__', 'constructor', 'toString'][item.variant % 4]!;
    plan(tool, {
      ...JSON.parse('{"__proto__":{"fuzz_canary":"synthetic"}}'),
      offers: [value],
      evaluatedAt: '2030-01-01T12:00:00Z',
    });
  }
  ensure(
    (Object.prototype as Record<string, unknown>).fuzz_canary === undefined,
    'PROTOTYPE_POLLUTION',
  );
}

if (process.argv.includes('--worker')) {
  const blockNetwork = (): never => {
    throw new Error('FUZZ_NETWORK_ATTEMPT');
  };
  http.request = blockNetwork;
  http.get = blockNetwork;
  https.request = blockNetwork;
  https.get = blockNetwork;
  globalThis.fetch = async () => {
    return blockNetwork();
  };
  const input: Case[] = JSON.parse(readFileSync(0, 'utf8'));
  for (const item of input) {
    console.log(JSON.stringify({ phase: 'start', id: item.id, target: item.target }));
    const start = performance.now();
    let outcome = 'accepted',
      code: string | undefined;
    try {
      outcome = exercise(item) ?? 'accepted';
    } catch (error) {
      if (error instanceof AppError && !item.target.startsWith('agent-')) {
        outcome = 'rejected';
        code = error.code;
      } else {
        outcome = 'finding';
        code =
          error instanceof AppError
            ? `UNEXPECTED_APP_ERROR_${error.code}`
            : error instanceof Error && /^FUZZ_[A-Z_]+$/.test(error.message)
              ? error.message
              : error instanceof Error
                ? error.name
                : 'UNKNOWN_THROW';
      }
    }
    if ((Object.prototype as Record<string, unknown>).fuzz_canary !== undefined) {
      outcome = 'finding';
      code = 'FUZZ_PROTOTYPE_POLLUTION';
    }
    console.log(
      JSON.stringify({
        phase: 'done',
        id: item.id,
        target: item.target,
        outcome,
        code,
        seconds: (performance.now() - start) / 1000,
      }),
    );
  }
} else {
  const flag = (name: string, fallback: string) => {
    const index = process.argv.indexOf(name);
    return index < 0 ? fallback : process.argv[index + 1]!;
  };
  const seed = Number(flag('--seed', '20261030'));
  const count = Number(flag('--cases', '13000'));
  const seconds = Number(flag('--seconds', '120'));
  ensure(
    Number.isSafeInteger(seed) &&
      Number.isInteger(count) &&
      count > 0 &&
      count <= 100000 &&
      Number.isInteger(seconds) &&
      seconds > 0 &&
      seconds <= 600,
    'INVALID_BUDGET',
  );
  const output = resolve(root, flag('--output', '.local/security-audit/fuzz/typescript.json'));
  const safe = ['.local/security-audit/fuzz', '.local/security-audit/v0.3/fuzz'].some((base) => {
    const descendant = relative(resolve(root, base), output);
    return descendant.length > 0 && !descendant.startsWith('..') && !descendant.includes(':');
  });
  ensure(safe && output.endsWith('.json'), 'INVALID_REPORT_PATH');
  mkdirSync(dirname(output), { recursive: true });
  const sourceNames = [
    'api/src/money.ts',
    'api/src/planning.ts',
    'api/src/validation.ts',
    'api/src/llm.ts',
    'api/src/ingestion.ts',
    'api/src/literal-facts.ts',
    'schema/src/planning.ts',
    'web/src/planning-examples.ts',
    'examples/trip-contract.json',
    'agent/catalog.ts',
    'agent/brief.ts',
    'agent/workflow.ts',
    'agent/expenses.ts',
    'agents/manifest.json',
    'schema/agent-catalog.schema.json',
    'schema/agent-brief.schema.json',
    'schema/agent-workflow.schema.json',
    'schema/expense-settlement.schema.json',
    'security/fuzz/typescript.ts',
  ];
  const fingerprint = () =>
    Object.fromEntries(
      sourceNames.map((name) => [
        name,
        createHash('sha256')
          .update(readFileSync(resolve(root, name)))
          .digest('hex'),
      ]),
    );
  const sources = fingerprint();
  const next = random(seed);
  const cases: Case[] = Array.from({ length: count }, (_, id) => ({
    id,
    target: targets[id % targets.length]!,
    seed: Math.floor(next() * 2 ** 32),
    variant: Math.floor(next() * 10000),
  }));
  const records: Result[] = [],
    findings: Result[] = [];
  const infrastructureIssues: Array<{ batch: number; code: string }> = [];
  const start = performance.now();
  for (
    let offset = 0;
    offset < count && (performance.now() - start) / 1000 < seconds;
    offset += 250
  ) {
    if (seconds * 1000 - (performance.now() - start) < 10000) break;
    const batch = cases.slice(offset, offset + 250);
    const result = spawnSync(
      process.execPath,
      ['--max-old-space-size=256', '--import', 'tsx', script, '--worker'],
      {
        cwd: root,
        input: JSON.stringify(batch),
        encoding: 'utf8',
        timeout: Math.min(10000, Math.max(100, seconds * 1000 - (performance.now() - start))),
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      },
    );
    const lines: Result[] = [];
    for (const line of (result.stdout ?? '').split(/\r?\n/)) {
      try {
        lines.push(JSON.parse(line) as Result);
      } catch {
        /* Partial child output is not a result. */
      }
    }
    records.push(...lines.filter((record) => record.phase === 'done'));
    findings.push(...lines.filter((record) => record.outcome === 'finding'));
    if (result.error || result.status !== 0) {
      const last = lines.findLast((record) => record.phase === 'start');
      if (!last) infrastructureIssues.push({ batch: offset, code: 'WORKER_BOOTSTRAP_FAILURE' });
      else
        findings.push({
          phase: 'done',
          id: last?.id ?? batch[0]!.id,
          target: last?.target ?? batch[0]!.target,
          outcome: 'finding',
          code: result.error?.message.includes('ETIMEDOUT') ? 'WORKER_TIMEOUT' : 'WORKER_EXIT',
        });
    }
  }
  for (const finding of findings.slice(0, 20))
    writeFileSync(
      resolve(dirname(output), `ts-${seed}-case-${finding.id}.json`),
      JSON.stringify(cases[finding.id], null, 2) + '\n',
    );
  const changed = JSON.stringify(sources) !== JSON.stringify(fingerprint());
  const summary = {
    status: findings.length
      ? 'FAIL'
      : records.length !== count || changed || infrastructureIssues.length
        ? 'INCOMPLETE'
        : 'PASS',
    tool: 'seeded-mutation-properties-typescript',
    node: process.version,
    seed,
    requestedCases: count,
    completedCases: records.length,
    seconds: (performance.now() - start) / 1000,
    workerWallTimeoutSeconds: 10,
    v8OldSpaceLimitMiB: 256,
    nativeProcessMemoryLimit: false,
    counts: {
      accepted: records.filter((record) => record.outcome === 'accepted').length,
      rejected: records.filter((record) => record.outcome === 'rejected').length,
      findings: findings.length,
    },
    targets: Object.fromEntries(
      targets.map((target) => [
        target,
        records.filter((record) => record.target === target).length,
      ]),
    ),
    targetOutcomes: Object.fromEntries(
      targets.map((target) => [
        target,
        {
          accepted: records.filter(
            (record) => record.target === target && record.outcome === 'accepted',
          ).length,
          rejected: records.filter(
            (record) => record.target === target && record.outcome === 'rejected',
          ).length,
          findings: findings.filter((record) => record.target === target).length,
        },
      ]),
    ),
    workflowClock: {
      value: '2030-01-01T12:00:00Z',
      source: 'trusted explicit argument, not caller JSON',
    },
    findings: findings.slice(0, 20),
    infrastructureIssues,
    sources,
    sourceChangedDuringRun: changed,
    scope:
      'seeded structured mutations and arithmetic/source invariants; not coverage-guided or exhaustive',
  };
  writeFileSync(output, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify({ ...summary, findings: undefined, sources: undefined }));
  if (findings.length) process.exitCode = 1;
  else if (records.length !== count || changed || infrastructureIssues.length) process.exitCode = 2;
}
