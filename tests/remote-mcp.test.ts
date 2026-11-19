import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'node:events';
import {
  createRemoteHttpServer,
  ensureRemoteData,
  pilotQuota,
  remoteConfig,
} from '../agent/remote-mcp.js';
import loyaltyInput from '../examples/loyalty-arbitrage.json' with { type: 'json' };
import expenseInput from '../examples/expense-settlement.json' with { type: 'json' };
import contextInput from '../examples/global-context.json' with { type: 'json' };

const config = remoteConfig({
  TRAVEL_MCP_PUBLIC_ORIGIN: 'https://travel-test.example.invalid',
  TRAVEL_MCP_ISSUER: 'https://auth-test.example.invalid',
  TRAVEL_MCP_PROOF_KEY: Buffer.alloc(32, 7).toString('base64url'),
});
let now = Date.parse('2026-11-19T12:00:00Z');
const server = createRemoteHttpServer(config, {
  clock: () => now,
  quota: async () => true,
  verify: async (token) => {
    if (!['fulla', 'fullb', 'reader', 'expired'].includes(token)) throw new Error('invalid');
    return {
      subject: token,
      scopes:
        token === 'reader' ? ['travel:read'] : ['travel:read', 'travel:calculate', 'travel:audit'],
      expiresAt: Math.floor(now / 1000) + (token === 'expired' ? -1 : 600),
    };
  },
});
let local: string;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing listener');
  local = 'http://127.0.0.1:' + address.port;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function post(method: string, params: unknown, auth = 'fulla', headers = {}) {
  return fetch(local + '/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      authorization: 'Bearer ' + auth,
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
}
async function rpc(method: string, params: unknown, auth?: string) {
  const response = await post(method, params, auth);
  const text = await response.text();
  const json = response.headers.get('content-type')?.startsWith('text/event-stream')
    ? text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6)
    : text;
  expect(response.status).toBe(200);
  expect(json).toBeTruthy();
  return JSON.parse(json!);
}
async function call(name: string, args: unknown, auth?: string) {
  return await rpc('tools/call', { name, arguments: args }, auth);
}

describe('remote MCP documentary profile', () => {
  it('serves protected-resource metadata and rejects missing, invalid and expired credentials', async () => {
    const meta = await fetch(local + '/.well-known/oauth-protected-resource/mcp');
    expect(await meta.json()).toMatchObject({
      resource: config.audience,
      authorization_servers: [config.issuer],
    });
    for (const token of ['unknown', 'expired']) {
      const response = await post('tools/list', {}, token);
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain(
        '/.well-known/oauth-protected-resource/mcp',
      );
      await response.text();
    }
  });

  it('negotiates a legacy client and exposes only the authorized remote tools', async () => {
    const init = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.result.serverInfo.name).toBe('travel-reliability');
    const full = await rpc('tools/list', {});
    expect(full.result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      'travel_audit_output',
      'travel_catalog',
      'travel_country_context',
      'travel_discover_packages',
      'travel_global_context',
      'travel_plan',
      'travel_schema',
      'travel_settle_expenses',
    ]);
    const reader = await rpc('tools/list', {}, 'reader');
    expect(reader.result.tools.map((t: { name: string }) => t.name)).not.toContain('travel_plan');
    const denied = await call('travel_workspace_inventory', {});
    expect(Boolean(denied.error || denied.result?.isError)).toBe(true);
    const deniedByScope = await call(
      'travel_plan',
      { tool: 'loyalty-arbitrage', input: loyaltyInput },
      'reader',
    );
    expect(Boolean(deniedByScope.error || deniedByScope.result?.isError)).toBe(true);
  });

  it('runs a calculation and validates its signed receipt only for the owner within its lifetime', async () => {
    const out = await call('travel_plan', { tool: 'loyalty-arbitrage', input: loyaltyInput });
    expect(out.result.isError, out.result.content[0].text).toBeFalsy();
    const payload = JSON.parse(out.result.content[0].text);
    expect(payload.audit).toMatchObject({
      factsVerified: false,
      inputProvenance: 'caller_declared',
    });
    const { proof, outputSha256 } = payload.remoteReceipt;
    const requests = { proofs: [{ proof, outputSha256, calculatorId: 'loyalty-arbitrage' }] };
    const verify = async (input: unknown, auth: string) => {
      const checked = await call('travel_audit_output', input, auth);
      return JSON.parse(checked.result.content[0].text).proofs[0].status;
    };
    expect(await verify(requests, 'fulla')).toBe('calculation_bound');
    expect(await verify(requests, 'fullb')).toBe('blocked');
    expect(
      await verify({ proofs: [{ ...requests.proofs[0], outputSha256: '0'.repeat(64) }] }, 'fulla'),
    ).toBe('blocked');
    now += 16 * 60_000;
    expect(await verify(requests, 'fulla')).toBe('blocked');
  });

  it('accepts the public or pseudonymous entries used by the remaining tools', async () => {
    const checks = [
      ['travel_catalog', { input: { kind: 'workflows', limit: 2 } }],
      ['travel_schema', { name: 'loyalty-arbitrage' }],
      ['travel_settle_expenses', { input: { ...expenseInput, tripKey: 'X01' } }],
      [
        'travel_global_context',
        {
          input: {
            ...contextInput,
            tripKey: 'X02',
            locations: contextInput.locations.map((location) => ({
              ...location,
              municipalityKey: 'X03',
            })),
          },
        },
      ],
      [
        'travel_country_context',
        { scope: { country: 'BR', subdivision: null, municipality: null }, persona: 'solo' },
      ],
      [
        'travel_discover_packages',
        {
          input: {
            origin: 'Petrolina',
            destination: null,
            windows: [{ id: 'X01', startDate: '2027-06-30', endDate: '2027-07-04' }],
          },
        },
      ],
    ] as const;
    for (const [name, args] of checks) {
      const response = await call(name, args);
      expect(response.result.isError, name + ': ' + response.result.content[0].text).toBeFalsy();
    }
  });
  it('rejects unexpected text in structured input without echoing it', async () => {
    expect(() => ensureRemoteData({ provider: 'Nome Real de Exemplo' })).toThrow(
      'REMOTE_INPUT_REQUIRES_CODES',
    );
    expect(() => ensureRemoteData({ url: 'https://example.invalid/unsafe' })).toThrow(
      'REMOTE_INPUT_REQUIRES_CODES',
    );
    const blocked = await call('travel_plan', {
      tool: 'loyalty-arbitrage',
      input: { ...loyaltyInput, extra: 'Nome Real de Exemplo' },
    });
    expect(blocked.result.isError).toBe(true);
    expect(blocked.result.content[0].text).not.toContain('Nome Real de Exemplo');
  });

  it('rejects an unexpected origin and oversized body', async () => {
    const origin = await post('tools/list', {}, 'fulla', {
      origin: 'https://test.example.invalid',
    });
    expect(origin.status).toBe(403);
    await origin.text();
    const large = await post('tools/list', { ignored: 'X'.repeat(129 * 1024) });
    expect(large.status).toBe(413);
    await large.text();
  });

  it('enforces pilot quotas and resets counts on minute boundaries', async () => {
    let clock = 0;
    const quota = pilotQuota(() => clock);
    for (let i = 0; i < 30; i++) expect(await quota('a')).toBe(true);
    expect(await quota('a')).toBe(false);
    expect(await quota('b')).toBe(true);
    clock = 60_000;
    expect(await quota('a')).toBe(true);
  });
});
