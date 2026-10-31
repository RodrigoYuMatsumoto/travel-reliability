import { mkdir, writeFile } from 'node:fs/promises';
import { planningSchemas, toolIds } from '../schema/src/planning.js';
import { inputSchemas } from '../api/src/input-schemas.js';
import { planningExamples } from '../web/src/planning-examples.js';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { demoTrip } from '../api/src/demo.js';
import trip from '../schema/trip-contract.schema.json' with { type: 'json' };
import { briefSchema } from '../agent/brief.js';
import { APP_VERSION } from '../api/src/version.js';
import { catalogSchema } from '../agent/catalog.js';
import { workflowSchema } from '../agent/workflow.js';
import { expenseSchema } from '../agent/expenses.js';
const json = async (path: string, value: unknown) =>
  writeFile(path, JSON.stringify(value, null, 2) + '\n');
await json('schema/agent-brief.schema.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Pseudonymous travel agent intake',
  ...briefSchema,
});
await mkdir('examples', { recursive: true });
await json('schema/agent-catalog.schema.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Portable agents and travel workflows catalog',
  ...catalogSchema,
});
await json('schema/agent-workflow.schema.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Read-only selected travel workflow preparation',
  ...workflowSchema,
});
await json('schema/expense-settlement.schema.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Known incurred expenses and accepted allocation weights',
  ...expenseSchema,
});
await json('examples/agent-workflow.json', {
  tripKey: 'demo-1',
  workflowId: 'compare-lodging',
  language: 'pt-BR',
  suppliedFields: ['travel_area'],
  capabilities: [],
  budget: { maxToolCalls: 8, maxRetries: 1, maxDelegations: 0 },
});
await json('examples/expense-settlement.json', {
  tripKey: 'demo-1',
  currency: 'BRL',
  acceptedRule: true,
  priorSettlements: [],
  households: ['N01', 'N02'],
  expenses: [
    {
      id: 'E01',
      amountMinor: 12000,
      paidBy: 'N01',
      beneficiaries: [
        { householdId: 'N01', weight: 1 },
        { householdId: 'N02', weight: 1 },
      ],
    },
  ],
});
for (const tool of toolIds) await json(`examples/${tool}.json`, planningExamples[tool]);
const synthetic = demoTrip();
synthetic.id = '00000000-0000-4000-8000-000000000010';
await json('examples/trip-contract.json', synthetic);
await json('schema/planning.schema.json', {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Documentary planning tools',
  $defs: planningSchemas,
});
const context = await buildApp(loadConfig({ APP_MODE: 'demo' }));
await context.app.ready();
const paths: Record<string, Record<string, unknown>> = {};
for (const route of context.apiRoutes) {
  if (route.method === 'HEAD') continue;
  const path = route.url.replace(/:([A-Za-z]+)/g, '{$1}'),
    method = route.method.toLowerCase();
  const operation: Record<string, unknown> = {
    operationId: `${method}_${path.replace(/[^a-zA-Z0-9]+/g, '_')}`,
    summary: `${route.method} ${path}`,
    tags: [path.split('/')[1]],
    responses: {
      '200': {
        description:
          'Operation result; see generated TypeScript domain interfaces and route implementation for response fields.',
      },
      '201': { description: 'Created' },
      '202': { description: 'Accepted for bounded asynchronous extraction' },
      '401': { description: 'Authentication required' },
      '403': { description: 'Permission, origin or CSRF failure' },
      '409': { description: 'Version conflict or conflicting field; resolve before retrying' },
      '422': { description: 'Invalid input or incomplete prerequisites' },
      '429': { description: 'Rate limited' },
      '503': { description: 'Capacity or dependency unavailable' },
    },
  };
  const parameters: unknown[] = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => ({
    name: match[1],
    in: 'path',
    required: true,
    schema: match[1] === 'tool' ? { type: 'string', enum: toolIds } : { type: 'string' },
  }));
  if (path.startsWith('/v1/')) {
    operation.security = [{ demoSession: [] }, { productionSession: [] }];
    parameters.push({
      name: 'x-workspace-id',
      in: 'header',
      required: false,
      description: 'An authorized shared workspace; membership is checked server-side.',
      schema: { type: 'string' },
    });
    if (method !== 'get')
      parameters.push({
        name: 'x-csrf-token',
        in: 'header',
        required: true,
        schema: { type: 'string' },
      });
  }
  if (method === 'put' && /^\/v1\/(trips|routes)\/\{id\}$/.test(path))
    parameters.push({
      name: 'If-Match',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description: 'Current integer revision, optionally quoted.',
    });
  if (path.endsWith('/export') && path.startsWith('/v1/trips/'))
    parameters.push({
      name: 'format',
      in: 'query',
      schema: { enum: ['json', 'pdf', 'ics'], default: 'json' },
    });
  if (path.endsWith('/checklists'))
    parameters.push({
      name: 'phase',
      in: 'query',
      schema: { enum: ['pre_booking', 'pre_departure'] },
    });
  if (path.endsWith('/export') && path.startsWith('/v1/trips/'))
    parameters.push({
      name: 'privacy',
      in: 'query',
      description:
        'Calendar only. Minimal excludes all free-text/private fields. Private requires an explicit choice.',
      schema: { enum: ['minimal', 'private'], default: 'minimal' },
    });
  if (parameters.length) operation.parameters = parameters;
  let body: object | undefined;
  if (['post', 'put'].includes(method)) {
    if (path === '/v1/trips' || (method === 'put' && path === '/v1/trips/{id}'))
      body = { $ref: '#/components/schemas/TripContract' };
    else if (path === '/v1/tools/{tool}')
      body = { anyOf: toolIds.map((id) => ({ $ref: '#/components/schemas/' + id })) };
    else {
      const name = path.endsWith('/apply')
        ? 'apply'
        : path.endsWith('/retention')
          ? 'retention'
          : path.endsWith('/suggest')
            ? 'consent'
            : path.endsWith('/moderate')
              ? 'moderation'
              : path.endsWith('/bundle')
                ? 'bundle'
                : /\/dossier(?:\/pdf)?$/.test(path)
                  ? 'dossier'
                  : path.endsWith('/events') || path.startsWith('/hooks/')
                    ? 'event'
                    : path === '/v1/reviews'
                      ? 'review'
                      : path.startsWith('/v1/routes')
                        ? 'route'
                        : path.endsWith('/members')
                          ? 'member'
                          : null;
      if (name) body = { $ref: '#/components/schemas/' + name };
    }
    if (body)
      operation.requestBody = { required: true, content: { 'application/json': { schema: body } } };
    if (path === '/v1/trips/{id}/documents')
      operation.requestBody = {
        required: true,
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: { file: { type: 'string', format: 'binary' } },
              additionalProperties: false,
            },
          },
        },
      };
  }
  if (path.startsWith('/hooks/')) {
    operation.description = 'Workspace-scoped HMAC signature required. See docs/PLUGINS.md.';
    operation.security = [{ webhookSignature: [] }];
  }
  (paths[path] ??= {})[method] = operation;
}
await json('api/openapi.json', {
  openapi: '3.1.0',
  jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
  info: {
    title: 'Travel Reliability API',
    version: APP_VERSION,
    description:
      'Documentary travel contracts and evidence. Never sends a booking or complaint. Response domain types: schema/src/domain.ts. Regenerate from registered routes with npm run contracts:generate.',
  },
  servers: [
    { url: 'http://127.0.0.1:4310', description: 'Loopback demo; production requires HTTPS' },
  ],
  paths,
  components: {
    securitySchemes: {
      demoSession: { type: 'apiKey', in: 'cookie', name: 'tr_session' },
      productionSession: { type: 'apiKey', in: 'cookie', name: '__Host-tr_session' },
      webhookSignature: { type: 'apiKey', in: 'header', name: 'x-tr-signature' },
    },
    schemas: { TripContract: trip, ...inputSchemas, ...planningSchemas },
  },
});
await context.app.close();
console.log(
  JSON.stringify({
    paths: Object.keys(paths).length,
    planningTools: toolIds.length,
    syntheticExamples: toolIds.length + 3,
  }),
);
