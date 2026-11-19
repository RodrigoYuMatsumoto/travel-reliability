import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as z from 'zod/v4';
import { listCatalog, catalogQuerySchema } from './catalog.js';
import { countryContext } from './country-packs.js';
import { prepareGlobalContext, globalContextSchema } from './global-context.js';
import { settleExpenses, expenseSchema } from './expenses.js';
import { discoverPackages } from './package-discovery.js';
import { digest, evidenceStatus, passiveJson, type EvidenceReference } from './provenance.js';
import { enforceContentPolicy } from './content-policy.js';
import { AppError } from '../api/src/errors.js';
import { APP_VERSION } from '../api/src/version.js';
import { plan } from '../api/src/planning.js';
import { planningSchemas, toolIds } from '../schema/src/planning.js';
import { packageDiscoverySchema } from '../schema/src/package-discovery.js';
import graph from '../data/loyalty_graph.json' with { type: 'json' };
import publicPacks from '../data/public-country-packs.json' with { type: 'json' };

export const remoteCalculators = toolIds.filter((id) => id !== 'negotiation');
const scopes = ['travel:read', 'travel:calculate', 'travel:audit'] as const;
const bodyLimit = 128 * 1024;
const outputLimit = 64 * 1024;
const proofLifetime = 15 * 60_000;
const graphHash = digest(graph);
const registry = [
  ...graph.evidence,
  ...publicPacks.flatMap((pack) => pack.evidence),
] as EvidenceReference[];
const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};
const codes = /^(?:[ELNPSX][0-9]{2,4}|SRC[0-9]{2,6}|[A-Z]{2,4})$/;
const publicWords = new Set([
  'air',
  'flight',
  'bus',
  'rail',
  'ground',
  'transfer',
  'mixed',
  'car',
  'walking',
  'ferry',
  'lodging',
  'hotel',
  'tourism',
  'business',
  'business_corporate',
  'solo',
  'family',
  'group',
  'economy',
  'premium_economy',
  'business_class',
  'first',
  'cash',
  'points',
  'pix',
  'card',
  'observed',
  'indicative',
  'historical',
  'declared',
  'confirmed',
  'unconfirmed',
  'not_applicable',
  'unknown',
  'not_required',
  'single',
  'separate',
  'included',
  'necessary',
  'optional',
  'conditional',
  'round_trip',
  'one_way',
  'per_person',
  'per_night',
  'per_room',
  'per_group',
  'reservation',
  'yes',
  'no',
  'traveler',
  'supplier',
  'connection',
  'actual',
  'estimated',
  'fixed',
  'proportional',
  'equal',
  'total',
  'shared',
  'private',
  'centurion_points',
  'same_holder',
  'active_accounts',
  'clube_esfera',
  'atrativa',
  'niel',
  'viajantes-do-valle',
  'augustus',
  'Petrolina',
  'Juazeiro',
  'none',
  'checked',
  'carry_on',
  'pt-BR',
  'en',
  'en-US',
  'en-GB',
  'metric',
  'imperial',
  'leisure',
  'geography',
  'history',
  'culture',
  'customs',
]);
const dateValue =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const zoneValue = /^[A-Za-z_+-]{1,25}(?:\/[A-Za-z0-9_+-]{1,35}){1,2}$/;
const publicIds = new Set<string>([
  ...remoteCalculators,
  ...graph.programs,

  ...registry.map(({ id }) => id),
]);
const publicUrls = new Set(registry.map(({ sourceUrl }) => sourceUrl));

export function ensureRemoteData(input: unknown): void {
  passiveJson(input);
  const visit = (data: unknown, key = ''): void => {
    if (typeof data === 'string') {
      const permitted =
        codes.test(data) ||
        publicWords.has(data) ||
        publicIds.has(data) ||
        (key === 'url' && publicUrls.has(data)) ||
        (key === 'administrativeArea' && /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(data)) ||
        (/date|time|arrival|departure|expire|observed|valid|scenario|purchase|utcOffset|at$/i.test(
          key,
        ) &&
          (dateValue.test(data) || /^(?:Z|[+-]\d{2}:\d{2})$/.test(data))) ||
        (/zone/i.test(key) && (data === 'UTC' || (zoneValue.test(data) && validZone(data))));
      if (!permitted) throw new AppError('REMOTE_INPUT_REQUIRES_CODES', 422);
    } else if (Array.isArray(data)) {
      for (const item of data) visit(item, key);
    } else if (data !== null && typeof data === 'object') {
      for (const [field, value] of Object.entries(data)) visit(value, field);
    }
  };
  visit(input);
}

function validZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const auditSchema = z.strictObject({
  proofs: z
    .array(
      z.strictObject({
        proof: z.string().max(1800),
        calculatorId: z.enum(remoteCalculators),
        outputSha256: z.string().regex(/^[a-f0-9]{64}$/),
      }),
    )
    .max(20)
    .default([]),
  evidenceIds: z
    .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/))
    .max(20)
    .default([]),
});
const map = z.record(z.string(), z.unknown());
const countryRequest = z.strictObject({
  scope: z.strictObject({
    country: z.string().regex(/^[A-Z]{2}$/),
    subdivision: z
      .string()
      .regex(/^[A-Z]{2}-[A-Z0-9]{1,3}$/)
      .nullable(),
    municipality: z
      .string()
      .regex(/^\d{1,8}$/)
      .nullable(),
  }),
  persona: z.enum(['solo', 'family', 'tourism', 'business_corporate']),
});

export type RemoteConfig = {
  issuer: string;
  origin: string;
  audience: string;
  key: Buffer;
};
type Principal = { subject: string; scopes: string[]; expiresAt: number };
type Verifier = (token: string) => Promise<Principal>;
type Quota = (pseudonym: string) => Promise<boolean>;

function origin(value: string | undefined, allowPath: boolean): URL {
  const url = new URL(value ?? '');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (!allowPath && url.pathname !== '/')
  )
    throw new Error('REMOTE_HTTPS_CONFIG_REQUIRED');
  return url;
}

export function remoteConfig(env: NodeJS.ProcessEnv): RemoteConfig {
  const publicOrigin = origin(env.TRAVEL_MCP_PUBLIC_ORIGIN, false).origin;
  const issuer = origin(env.TRAVEL_MCP_ISSUER, false).href;
  const audience = publicOrigin + '/mcp';
  const key = Buffer.from(env.TRAVEL_MCP_PROOF_KEY ?? '', 'base64url');
  if (key.length !== 32 || key.toString('base64url') !== env.TRAVEL_MCP_PROOF_KEY)
    throw new Error('REMOTE_PROOF_KEY_REQUIRED');
  return { issuer, origin: publicOrigin, audience, key };
}

function auth0Verifier(config: RemoteConfig): Verifier {
  const jwks = createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer), {
    timeoutDuration: 4000,
    cooldownDuration: 30_000,
  });
  return async (token) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
      maxTokenAge: '1 hour',
    });
    if (!payload.sub || payload.sub.length > 240 || typeof payload.exp !== 'number')
      throw new Error('REMOTE_TOKEN_INVALID');
    return {
      subject: payload.sub,
      scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
      expiresAt: payload.exp,
    };
  };
}

export function pilotQuota(now = Date.now): Quota {
  let minute = -1;
  let total = 0;
  const counts = new Map<string, number>();
  return async (principal) => {
    const current = Math.floor(now() / 60_000);
    if (current !== minute) {
      minute = current;
      total = 0;
      counts.clear();
    }
    const count = counts.get(principal) ?? 0;
    if (total >= 240 || count >= 30) return false;
    total++;
    counts.set(principal, count + 1);
    return true;
  };
}

function mac(config: RemoteConfig, domain: string, data: string) {
  return createHmac('sha256', config.key)
    .update(domain)
    .update('\0')
    .update(data)
    .digest('base64url');
}

function makeProof(
  config: RemoteConfig,
  principal: string,
  tool: string,
  input: unknown,
  output: unknown,
  now: number,
) {
  const record = {
    v: 1,
    principal,
    tool,
    inputSha256: digest(input),
    outputSha256: digest(output),
    datasetSha256: tool === 'loyalty-arbitrage' ? graphHash : null,
    release: APP_VERSION,
    issuedAt: now,
    expiresAt: now + proofLifetime,
  };
  const blob = Buffer.from(JSON.stringify(record)).toString('base64url');
  return { ...record, proof: blob + '.' + mac(config, 'proof', blob) };
}

function checkProof(
  config: RemoteConfig,
  principal: string,
  claim: z.infer<typeof auditSchema>['proofs'][number],
  now: number,
) {
  const pieces = claim.proof.split('.');
  const [blob, signature] = pieces;
  if (
    pieces.length !== 2 ||
    !blob ||
    !signature ||
    !/^[A-Za-z0-9_-]+$/.test(blob) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  )
    return false;
  const expected = mac(config, 'proof', blob);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  try {
    const proof = JSON.parse(Buffer.from(blob, 'base64url').toString('utf8'));
    return (
      proof.v === 1 &&
      proof.principal === principal &&
      proof.tool === claim.calculatorId &&
      proof.outputSha256 === claim.outputSha256 &&
      Number.isSafeInteger(proof.issuedAt) &&
      proof.issuedAt <= now &&
      proof.expiresAt === proof.issuedAt + proofLifetime &&
      proof.expiresAt > now
    );
  } catch {
    return false;
  }
}

function result(action: () => unknown) {
  let text: string;
  let isError = false;
  try {
    const payload = action();
    enforceContentPolicy(payload);
    text = JSON.stringify(payload);
    if (Buffer.byteLength(text) > outputLimit - 4096)
      throw new AppError('REMOTE_OUTPUT_LIMIT', 422);
  } catch (error) {
    isError = true;
    text = JSON.stringify({ error: error instanceof AppError ? error.code : 'REMOTE_TOOL_FAILED' });
  }
  return { ...(isError ? { isError: true } : {}), content: [{ type: 'text' as const, text }] };
}

const publishedSchemas = {
  catalog: catalogQuerySchema,
  expenses: expenseSchema,
  'global-context': globalContextSchema,
  'country-context': z.toJSONSchema(countryRequest),
  'claim-audit': z.toJSONSchema(auditSchema),
  'package-discovery': packageDiscoverySchema,
  ...Object.fromEntries(remoteCalculators.map((id) => [id, planningSchemas[id]])),
};

function createRemoteTools(
  config: RemoteConfig,
  principal: string,
  permissions: string[],
  clock: () => number,
) {
  const server = new McpServer(
    { name: 'travel-reliability', version: APP_VERSION },
    {
      instructions:
        'Documentary travel calculations. Use codes or pseudonyms, never personal records. Unknown data remains unknown.',
    },
  );
  // Missing scopes omit the corresponding tool on every request, including direct calls.
  if (permissions.includes('travel:read')) {
    server.registerTool(
      'travel_catalog',
      {
        title: 'Travel catalog',
        description: 'List one page of travel workflows and their remote availability.',
        inputSchema: z.strictObject({ input: map.optional() }),
        annotations,
      },
      ({ input }) =>
        result(() => {
          const page = listCatalog(input);
          return {
            ...page,
            items: page.items.map(({ resourceUri: _uri, ...row }) => ({
              ...row,
              remote:
                'calculatorId' in row && remoteCalculators.some((id) => id === row.calculatorId),
            })),
          };
        }),
    );
    server.registerTool(
      'travel_schema',
      {
        title: 'Travel input contract',
        description: 'Read the contract and text restrictions for one remote calculation.',
        inputSchema: z.strictObject({ name: z.string().max(64) }),
        annotations,
      },
      ({ name }) =>
        result(() => {
          if (!Object.hasOwn(publishedSchemas, name))
            throw new AppError('REMOTE_SCHEMA_UNAVAILABLE', 404);
          return {
            schema: publishedSchemas[name as keyof typeof publishedSchemas],
            textPolicy: {
              identifiers: codes.source,
              words: [...publicWords],
              publicIds: [...publicIds],
            },
          };
        }),
    );
    server.registerTool(
      'travel_country_context',
      {
        title: 'Country context',
        description:
          'Read documented or provisional public guidance by geography and trip persona.',
        inputSchema: countryRequest,
        annotations,
      },
      (input) =>
        result(() =>
          countryContext(
            {
              ...input,
              packs: publicPacks,
              evaluatedAt: new Date(clock()).toISOString(),
            },
            registry,
          ),
        ),
    );
    server.registerTool(
      'travel_discover_packages',
      {
        title: 'Regional travel source references',
        description:
          'Read a static regional catalog. A catalog reference does not establish an offer.',
        inputSchema: z.strictObject({ input: map }),
        annotations,
      },
      ({ input }) =>
        result(() => {
          ensureRemoteData(input);
          return discoverPackages(input);
        }),
    );
  }
  if (permissions.includes('travel:calculate')) {
    server.registerTool(
      'travel_plan',
      {
        title: 'Documentary travel calculation',
        description:
          'Calculate from supplied structured values. Source claims and availability remain caller-declared.',
        inputSchema: z.strictObject({ tool: z.enum(remoteCalculators), input: map }),
        annotations,
      },
      ({ tool, input }) =>
        result(() => {
          ensureRemoteData(input);
          const computed = plan(tool, input);
          const { principal: _principal, ...remoteReceipt } = makeProof(
            config,
            principal,
            tool,
            input,
            computed,
            clock(),
          );
          return { ...computed, remoteReceipt };
        }),
    );
    server.registerTool(
      'travel_settle_expenses',
      {
        title: 'Travel expense settlement',
        description: 'Reconcile existing expenses using only pseudonyms and structured amounts.',
        inputSchema: z.strictObject({ input: map }),
        annotations,
      },
      ({ input }) =>
        result(() => {
          ensureRemoteData(input);
          return settleExpenses(input);
        }),
    );
    server.registerTool(
      'travel_global_context',
      {
        title: 'Documentary travel context',
        description: 'Resolve trip dates, time zones and territorial codes from supplied data.',
        inputSchema: z.strictObject({ input: map }),
        annotations,
      },
      ({ input }) =>
        result(() => {
          ensureRemoteData(input);
          return prepareGlobalContext(input, clock());
        }),
    );
  }
  if (permissions.includes('travel:audit')) {
    server.registerTool(
      'travel_audit_output',
      {
        title: 'Travel evidence and calculation check',
        description:
          'Validate signed calculation receipts and reviewed source references. Facts require appropriate evidence.',
        inputSchema: auditSchema,
        annotations,
      },
      ({ proofs, evidenceIds }) =>
        result(() => ({
          proofs: proofs.map((claim) => ({
            calculatorId: claim.calculatorId,
            status: checkProof(config, principal, claim, clock()) ? 'calculation_bound' : 'blocked',
          })),
          evidence: evidenceIds.map((id) => {
            const record = registry.find((entry) => entry.id === id);
            const status = evidenceStatus(record, new Date(clock()).toISOString());
            return status === 'supported'
              ? { id, status, assertion: record!.assertion }
              : { id, status };
          }),
          factsVerified: false,
        })),
    );
  }
  return server;
}

export function createRemoteHandler(
  config: RemoteConfig,
  {
    verify = auth0Verifier(config),
    quota = pilotQuota(),
    clock = Date.now,
  }: { verify?: Verifier; quota?: Quota; clock?: () => number } = {},
) {
  const metadata = config.origin + '/.well-known/oauth-protected-resource/mcp';
  const rpc = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error('REMOTE_AUTH_REQUIRED');
      return createRemoteTools(config, authInfo.clientId, authInfo.scopes, clock);
    },
    { maxRequestBodySize: bodyLimit },
  );
  const json = (body: unknown, status: number, headers?: Record<string, string>) =>
    Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.origin !== config.origin || url.search) return json({ error: 'not_found' }, 404);
    if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok' }, 200);
    if (request.method === 'GET' && url.href === metadata)
      return json(
        {
          resource: config.audience,
          authorization_servers: [config.issuer],
          scopes_supported: scopes,
          bearer_methods_supported: ['header'],
        },
        200,
      );
    if (url.pathname !== '/mcp') return json({ error: 'not_found' }, 404);
    const originHeader = request.headers.get('origin');
    if (originHeader && ![config.origin, 'https://claude.ai'].includes(originHeader))
      return json({ error: 'origin_rejected' }, 403);
    const auth = request.headers.get('authorization');
    const token =
      auth && auth.length <= 8192 && /^Bearer [A-Za-z0-9._-]+$/i.test(auth) ? auth.slice(7) : null;
    const principal = token ? await verify(token).catch(() => null) : null;
    if (!principal || principal.expiresAt <= Math.floor(clock() / 1000))
      return json({ error: 'unauthorized' }, 401, {
        'www-authenticate':
          'Bearer resource_metadata="' + metadata + '", scope="' + scopes.join(' ') + '"',
      });
    const granted = scopes.filter((scope) => principal.scopes.includes(scope));
    if (!granted.length) return json({ error: 'insufficient_scope' }, 403);
    const pseudonym = mac(config, 'principal', principal.subject);
    const admitted = await quota(pseudonym).catch(() => null);
    if (admitted === null) return json({ error: 'quota_unavailable' }, 503);
    if (!admitted) return json({ error: 'rate_limited' }, 429, { 'retry-after': '60' });
    return rpc.fetch(request, {
      authInfo: { token: '', clientId: pseudonym, scopes: granted, expiresAt: principal.expiresAt },
    });
  };
}

export function createRemoteHttpServer(
  config: RemoteConfig,
  options?: Parameters<typeof createRemoteHandler>[1],
) {
  const handler = createRemoteHandler(config, options);
  return createServer(
    { maxHeaderSize: 12_288, requestTimeout: 30_000, headersTimeout: 10_000 },
    (req, res) => void serve(req, res),
  );

  async function serve(req: IncomingMessage, res: ServerResponse) {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 30_000);
    res.once('close', () => abort.abort());
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) {
        res.writeHead(400).end();
        return;
      }
      const requestMethod = req.method ?? 'GET';
      const hasBody = !['GET', 'HEAD'].includes(requestMethod);
      const request = new Request(new URL(req.url, config.origin), {
        method: requestMethod,
        headers: new Headers(
          Object.entries(req.headers).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, Array.isArray(value) ? value.join(', ') : value]],
          ),
        ),
        signal: abort.signal,
        ...(hasBody
          ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array>, duplex: 'half' }
          : {}),
      });
      const reply = await handler(request);
      res.writeHead(reply.status, {
        ...Object.fromEntries(reply.headers),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      if (reply.body)
        await pipeline(
          Readable.fromWeb(reply.body as unknown as NodeReadableStream<Uint8Array>),
          res,
          { signal: abort.signal },
        );
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(500, { 'cache-control': 'no-store' }).end();
      else res.destroy();
    } finally {
      clearTimeout(timeout);
    }
  }
}
