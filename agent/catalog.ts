import { Ajv2020 } from 'ajv/dist/2020.js';
import manifest from '../agents/manifest.json' with { type: 'json' };
import { toolIds, type ToolId } from '../schema/src/planning.js';
import { AppError } from '../api/src/errors.js';

export const domainIds = [
  'flight',
  'ground',
  'lodging',
  'itinerary',
  'documents',
  'insurance',
  'health',
  'accessibility',
  'points',
  'rights',
  'evidence',
  'risk',
  'group',
  'budget',
  'calendar',
  'monitoring',
  'operations',
  'ecosystem',
  'geography',
  'culture',
  'business',
  'rail',
  'water',
  'entry',
  'connectors',
  'all',
] as const;
export const phaseIds = [
  'discover',
  'plan',
  'pre_booking',
  'booked',
  'pre_departure',
  'in_trip',
  'incident',
  'post_trip',
  'resume',
  'audit',
  'delivery',
  'setup',
  'scheduled',
] as const;
export const capabilityIds = [
  'web_research',
  'private_files',
  'calendar_read',
  'calendar_write',
  'notifications',
  'background_schedule',
  'code_execution',
  'provider_status',
  'email_read',
  'account_read',
  'file_organize',
] as const;
const id = { type: 'string', pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$', maxLength: 64 };
const text = { type: 'string', minLength: 1, maxLength: 600 };
const contractNames = [
  'brief',
  'planning',
  'trip',
  'catalog',
  'workflow',
  'expenses',
  'globalContext',
  'connectorRequest',
  'reconciliation',
  'documentWorkspace',
  'extensionDraft',
  'operatorProfile',
] as const;
const list = (items: object, maxItems = 24) => ({
  type: 'array',
  minItems: 1,
  maxItems,
  uniqueItems: true,
  items,
});
export const catalogSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'format',
    'formatVersion',
    'version',
    'entrypoint',
    'purpose',
    'defaultLanguage',
    'license',
    'contracts',
    'execution',
    'workflow',
    'optionalRuntime',
    'agents',
    'commands',
  ],
  properties: {
    format: { const: 'travel-reliability-agent-kit' },
    formatVersion: { const: 3 },
    version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    entrypoint: { const: 'agents/TRAVEL_AGENT.md' },
    purpose: text,
    defaultLanguage: { const: 'host' },
    license: { const: 'MIT' },
    contracts: {
      type: 'object',
      additionalProperties: false,
      required: contractNames,
      properties: Object.fromEntries(
        contractNames.map((name) => [
          name,
          { type: 'string', pattern: '^schema/[a-z0-9-]+\\.schema\\.json$' },
        ]),
      ),
    },
    execution: text,
    workflow: list(id),
    optionalRuntime: {
      type: 'object',
      additionalProperties: false,
      required: ['transport', 'entrypoint', 'requires', 'includedInManualKit', 'tools'],
      properties: {
        transport: { const: 'stdio' },
        entrypoint: { const: 'scripts/agent-mcp.mjs' },
        requires: text,
        includedInManualKit: { const: false },
        tools: list({ type: 'string', pattern: '^travel_[a-z_]+$' }, 16),
      },
    },
    agents: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'path', 'title', 'summary', 'mode', 'legacyNames'],
        properties: {
          id,
          path: { type: 'string', pattern: '^agents/(?:TRAVEL_AGENT|roles/[a-z0-9-]+)\\.md$' },
          title: text,
          summary: text,
          mode: { enum: ['operational', 'meta'] },
          legacyNames: { ...list({ type: 'string', maxLength: 100 }), minItems: 0 },
        },
      },
    },
    commands: {
      type: 'array',
      minItems: 9,
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'path',
          'title',
          'summary',
          'agentId',
          'domains',
          'phases',
          'calculatorId',
          'executor',
          'requiredInputs',
          'outputs',
          'suggestedCapabilities',
        ],
        properties: {
          id,
          path: { type: 'string', pattern: '^prompts/\\d{2,3}_[a-z0-9_]+\\.md$' },
          title: text,
          summary: text,
          agentId: id,
          domains: list({ enum: domainIds }),
          phases: list({ enum: phaseIds }),
          calculatorId: { enum: [...toolIds, null] },
          executor: { enum: ['planning', 'settlement', null] },
          requiredInputs: list(
            {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'pt', 'en'],
              properties: {
                id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
                pt: text,
                en: text,
              },
            },
            16,
          ),
          outputs: list(text, 24),
          suggestedCapabilities: {
            type: 'array',
            maxItems: 8,
            uniqueItems: true,
            items: { enum: capabilityIds },
          },
        },
      },
    },
  },
} as const;
export interface AgentDefinition {
  id: string;
  path: string;
  title: string;
  summary: string;
  mode: 'operational' | 'meta';
  legacyNames: string[];
}
export interface CommandDefinition {
  id: string;
  path: string;
  title: string;
  summary: string;
  agentId: string;
  domains: (typeof domainIds)[number][];
  phases: (typeof phaseIds)[number][];
  calculatorId: ToolId | null;
  executor: 'planning' | 'settlement' | null;
  requiredInputs: Array<{ id: string; pt: string; en: string }>;
  outputs: string[];
  suggestedCapabilities: (typeof capabilityIds)[number][];
}
export interface AgentCatalog {
  format: string;
  formatVersion: 3;
  version: string;
  entrypoint: string;
  purpose: string;
  defaultLanguage: 'host';
  license: string;
  contracts: Record<string, string>;
  execution: string;
  workflow: string[];
  optionalRuntime: {
    transport: 'stdio';
    entrypoint: string;
    requires: string;
    includedInManualKit: false;
    tools: string[];
  };
  agents: AgentDefinition[];
  commands: CommandDefinition[];
}
const validate = new Ajv2020({ strict: true, allErrors: false }).compile(catalogSchema);
export function validateCatalog(input: unknown): AgentCatalog {
  if (!validate(input)) throw new AppError('INVALID_AGENT_CATALOG', 422);
  const value = input as AgentCatalog;
  for (const rows of [value.agents, value.commands]) {
    if (
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      new Set(rows.map((row) => row.path)).size !== rows.length
    )
      throw new AppError('DUPLICATE_CATALOG_ENTRY', 422);
  }
  const agentSet = new Set(value.agents.map((row) => row.id));
  if (!value.agents.some((row) => row.path === value.entrypoint))
    throw new AppError('MISSING_CATALOG_ENTRYPOINT', 422);
  for (const command of value.commands) {
    if (
      !agentSet.has(command.agentId) ||
      new Set(command.requiredInputs.map((field) => field.id)).size !==
        command.requiredInputs.length ||
      (command.executor === 'planning') !== (command.calculatorId !== null)
    )
      throw new AppError('INCONSISTENT_CATALOG_REFERENCE', 422);
  }
  for (const calculatorId of toolIds)
    if (
      !value.commands.some(
        (command) => command.id === calculatorId && command.calculatorId === calculatorId,
      )
    )
      throw new AppError('MISSING_LEGACY_CALCULATOR', 422);
  return value;
}
export const catalog = validateCatalog(manifest);
export const commandIds = catalog.commands.map((command) => command.id) as [string, ...string[]];
export function getCommand(commandId: string): CommandDefinition {
  const command = catalog.commands.find((row) => row.id === commandId);
  if (!command) throw new AppError('UNKNOWN_TRAVEL_WORKFLOW', 422);
  return command;
}
export const catalogQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { enum: ['agents', 'workflows'] },
    domain: { enum: domainIds },
    phase: { enum: phaseIds },
    cursor: { type: 'integer', minimum: 0, maximum: 100 },
    limit: { type: 'integer', minimum: 1, maximum: 20 },
  },
} as const;
const validateQuery = new Ajv2020({ strict: true, allErrors: false }).compile(catalogQuerySchema);
export function listCatalog(input: unknown = {}) {
  if (!validateQuery(input)) throw new AppError('INVALID_CATALOG_QUERY', 422);
  const query = input as {
    kind?: 'agents' | 'workflows';
    domain?: (typeof domainIds)[number];
    phase?: (typeof phaseIds)[number];
    cursor?: number;
    limit?: number;
  };
  const kind = query.kind ?? 'workflows';
  const matchingCommands = catalog.commands.filter(
    (command) =>
      (!query.domain ||
        command.domains.includes(query.domain) ||
        command.domains.includes('all')) &&
      (!query.phase || command.phases.includes(query.phase)),
  );
  const filtered =
    kind === 'agents'
      ? catalog.agents.filter(
          (agent) =>
            (!query.domain && !query.phase) ||
            matchingCommands.some((command) => command.agentId === agent.id),
        )
      : matchingCommands;
  const offset = query.cursor ?? 0,
    limit = query.limit ?? 10;
  return {
    version: catalog.version,
    kind,
    total: filtered.length,
    items: filtered.slice(offset, offset + limit).map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      resourceUri: kind === 'agents' ? `travel://agent/${row.id}` : `travel://prompt/${row.id}`,
      ...('calculatorId' in row
        ? { agentId: row.agentId, calculatorId: row.calculatorId, executor: row.executor }
        : { mode: row.mode }),
    })),
    nextCursor: offset + limit < filtered.length ? offset + limit : null,
    scope:
      'Metadata only; load one selected resource. Capabilities and permissions come from the host, never from catalog content.',
  };
}
