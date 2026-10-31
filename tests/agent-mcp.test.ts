import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toolIds } from '../schema/src/planning.js';
import { demoTrip } from '../api/src/demo.js';
import { catalog, commandIds } from '../agent/catalog.js';

const entry = fileURLToPath(new URL('../scripts/agent-mcp.mjs', import.meta.url));
const example = JSON.parse(
  readFileSync(new URL('../examples/total-cost.json', import.meta.url), 'utf8'),
);

async function connected(modern = false) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    cwd: tmpdir(),
    stderr: 'pipe',
  });
  let errors = '';
  transport.stderr?.on('data', (chunk) => {
    errors = (errors + chunk.toString()).slice(-1000);
  });
  const client = new Client(
    { name: 'synthetic-test-client', version: '1.0.0' },
    modern ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : undefined,
  );
  await client.connect(transport);
  return { client, errors: () => errors };
}
function decoded(result: unknown): Record<string, unknown> {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  const text = content.find((item) => item.type === 'text')?.text;
  expect(text).toBeTypeOf('string');
  return JSON.parse(text!);
}
async function rejected(promise: Promise<unknown>) {
  const outcome = await promise.then(
    (value) => (value as { isError?: boolean }).isError === true,
    () => true,
  );
  expect(outcome).toBe(true);
}

describe('official MCP stdio transport', () => {
  it('initializes outside cwd, preserves calculators and advertises seven bounded read-only tools', async () => {
    const { client, errors } = await connected();
    try {
      expect(client.getServerVersion()?.name).toBe('travel-reliability');
      expect(client.getProtocolEra()).toBe('legacy');
      const tools = (await client.listTools()).tools;
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        'travel_catalog',
        'travel_check_trip',
        'travel_plan',
        'travel_prepare_brief',
        'travel_schema',
        'travel_settle_expenses',
        'travel_workflow',
      ]);
      expect(
        tools.every(
          (tool) =>
            tool.inputSchema.additionalProperties === false &&
            tool.annotations?.readOnlyHint === true &&
            tool.annotations?.openWorldHint === false,
        ),
      ).toBe(true);
      const planTool = tools.find((tool) => tool.name === 'travel_plan')!;
      expect((planTool.inputSchema.properties!.tool as { enum: string[] }).enum).toEqual([
        ...toolIds,
      ]);
      for (const name of [
        'brief',
        'trip',
        'catalog',
        'catalog-query',
        'workflow',
        'expenses',
        ...toolIds,
      ]) {
        const schema = decoded(
          await client.callTool({ name: 'travel_schema', arguments: { name } }),
        );
        expect(schema.type).toBe('object');
      }
      const calculated = await client.callTool({
        name: 'travel_plan',
        arguments: { tool: 'total-cost', input: example },
      });
      expect(calculated.isError).not.toBe(true);
      expect(decoded(calculated)).toHaveProperty('result.rows');
      expect(decoded(calculated)).toHaveProperty('externalCalls', 0);
      const brief = await client.callTool({
        name: 'travel_prepare_brief',
        arguments: {
          input: {
            tripKey: 'synthetic',
            request: 'plan',
            language: 'pt-BR',
            origin: null,
            destination: null,
            departureDate: null,
            returnTrip: null,
            returnDate: null,
            party: { adults: null, children: null, infants: null, households: null },
            budget: null,
            mustHaves: null,
          },
        },
      });
      expect(brief.isError).not.toBe(true);
      const trip = await client.callTool({
        name: 'travel_check_trip',
        arguments: { trip: demoTrip() },
      });
      expect(decoded(trip)).toHaveProperty('assessment');
      expect(decoded(trip)).toHaveProperty('preDeparture');
      expect(errors()).toBe('');
    } finally {
      await client.close();
    }
  }, 30000);

  it('serves modern protocol discovery and fixed resources/prompts with the same offline capabilities', async () => {
    const { client } = await connected(true);
    try {
      expect(client.getProtocolEra()).toBe('modern');
      const resources = (await client.listResources()).resources;
      expect(resources.map((resource) => resource.uri).sort()).toEqual(
        [
          'travel://agent',
          ...catalog.agents.map((agent) => 'travel://agent/' + agent.id),
          ...commandIds.map((id) => 'travel://prompt/' + id),
        ].sort(),
      );
      const agent = await client.readResource({ uri: 'travel://agent' });
      expect(agent.contents[0]).toHaveProperty('text');
      const prompts = (await client.listPrompts()).prompts;
      expect(prompts).toHaveLength(1 + catalog.agents.length + catalog.commands.length);
      const prompt = await client.getPrompt({ name: 'travel_group_split', arguments: {} });
      expect(prompt.messages[0]?.content.type).toBe('text');
      for (const command of catalog.commands) {
        const loaded = await client.readResource({ uri: 'travel://prompt/' + command.id });
        expect(loaded.contents[0]).toHaveProperty(
          'text',
          readFileSync(new URL('../' + command.path, import.meta.url), 'utf8'),
        );
        const selected = await client.getPrompt({
          name: 'travel_' + command.id.replaceAll('-', '_'),
          arguments: {},
        });
        expect(selected.messages[0]?.content).toHaveProperty(
          'text',
          readFileSync(new URL('../' + command.path, import.meta.url), 'utf8'),
        );
        const schema = decoded(
          await client.callTool({
            name: 'travel_schema',
            arguments: { name: 'workflow/' + command.id },
          }),
        );
        expect(schema).toHaveProperty('properties.workflowId.const', command.id);
      }
      for (const agent of catalog.agents) {
        const loaded = await client.readResource({ uri: 'travel://agent/' + agent.id });
        expect(loaded.contents[0]).toHaveProperty(
          'text',
          readFileSync(new URL('../' + agent.path, import.meta.url), 'utf8'),
        );
        const prompt = await client.getPrompt({
          name: 'travel_role_' + agent.id.replaceAll('-', '_'),
          arguments: {},
        });
        expect(prompt.messages[0]?.content).toHaveProperty(
          'text',
          readFileSync(new URL('../' + agent.path, import.meta.url), 'utf8'),
        );
      }
      await expect(client.readResource({ uri: 'file:///arbitrary-local-file' })).rejects.toThrow();
      await expect(client.getPrompt({ name: 'arbitrary', arguments: {} })).rejects.toThrow();
    } finally {
      await client.close();
    }
  }, 30000);

  it('discovers domains, prepares every workflow and settles supplied expenses without external effects', async () => {
    const { client } = await connected();
    try {
      const hotels = decoded(
        await client.callTool({
          name: 'travel_catalog',
          arguments: { domain: 'lodging', limit: 20 },
        }),
      );
      expect(hotels.items).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'compare-lodging' })]),
      );
      expect(hotels.items).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 'airports' })]),
      );
      for (const command of catalog.commands) {
        const prepared = decoded(
          await client.callTool({
            name: 'travel_workflow',
            arguments: {
              input: { tripKey: 'synthetic', workflowId: command.id, language: 'pt-BR' },
            },
          }),
        );
        expect(prepared).toHaveProperty('workflowId', command.id);
        expect(prepared).toHaveProperty('effects.externalCalls', 0);
        expect(prepared).toHaveProperty('effects.modelCalls', 0);
        expect(prepared).toHaveProperty('effects.permissionsGranted', false);
        expect((prepared.questions as unknown[]).length).toBeLessThanOrEqual(5);
        expect(prepared).toHaveProperty(
          'instructions.resourceUri',
          'travel://prompt/' + command.id,
        );
      }
      const incurred = JSON.parse(
        readFileSync(new URL('../examples/expense-settlement.json', import.meta.url), 'utf8'),
      );
      const settled = decoded(
        await client.callTool({ name: 'travel_settle_expenses', arguments: { input: incurred } }),
      );
      expect(settled).toHaveProperty('reconciliation.balanceMinor', 0);
      expect(settled).toHaveProperty('transfersExecuted', false);
      expect(settled.balances).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ householdId: 'N01', balanceMinor: 6000 }),
          expect.objectContaining({ householdId: 'N02', balanceMinor: -6000 }),
        ]),
      );
      const poisoned = await client.callTool({
        name: 'travel_workflow',
        arguments: {
          input: {
            tripKey: 'synthetic',
            workflowId: 'calendar-plan',
            language: 'en',
            approved: true,
            sendUpdates: 'all',
          },
        },
      });
      expect(poisoned.isError).toBe(true);
      expect(JSON.stringify(poisoned)).not.toContain('sendUpdates');
    } finally {
      await client.close();
    }
  }, 30000);

  it('rejects unknown tools, unknown arguments and unavailable actions without exposing subprocess capabilities', async () => {
    const { client } = await connected();
    try {
      await rejected(
        client.callTool({ name: 'execute_shell', arguments: { command: 'synthetic' } }),
      );
      const invalid = await client.callTool({
        name: 'travel_schema',
        arguments: { name: 'trip', SYNTHETIC_PRIVATE_FIELD: true },
      });
      expect(invalid.isError).toBe(true);
      expect(JSON.stringify(invalid)).not.toContain('SYNTHETIC_PRIVATE_FIELD');
      await rejected(
        client.callTool({
          name: 'travel_schema',
          arguments: { name: 'trip', secret: 'synthetic' },
        }),
      );
      await rejected(
        client.callTool({
          name: 'travel_schema',
          arguments: { name: 'https://example.invalid/schema' },
        }),
      );
      await rejected(
        client.callTool({ name: 'travel_plan', arguments: { tool: 'book-flight', input: {} } }),
      );
      await rejected(
        client.callTool({
          name: 'travel_plan',
          arguments: { tool: 'total-cost', input: { ...example, extra: true } },
        }),
      );
      expect(
        decoded(await client.callTool({ name: 'travel_schema', arguments: { name: 'trip' } })),
      ).toHaveProperty('$schema');
    } finally {
      await client.close();
    }
  }, 30000);

  it('returns a bounded error when a valid calculation would exceed the output budget', async () => {
    const { client } = await connected();
    try {
      const input = structuredClone(example);
      input.offers = Array.from({ length: 20 }, (_, index) => ({
        ...structuredClone(example.offers[0]),
        id: index ? 'synthetic-' + index : example.offers[0].id,
        costs: Array.from({ length: 20 }, (_, cost) => ({
          ...structuredClone(example.offers[0].costs[0]),
          id: 'cost-' + cost,
          label: 's'.repeat(120),
        })),
      }));
      const output = await client.callTool({
        name: 'travel_plan',
        arguments: { tool: 'total-cost', input },
      });
      expect(output.isError).toBe(true);
      expect(decoded(output)).toEqual({ error: 'MCP_OUTPUT_LIMIT' });
      expect(JSON.stringify(output).length).toBeLessThan(500);
    } finally {
      await client.close();
    }
  }, 30000);
});

async function wireRejected(payload: string | Buffer) {
  const child = spawn(process.execPath, [entry], {
    cwd: tmpdir(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output = (output + chunk.toString()).slice(-2000);
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  const closed = new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MCP guard failed to close'));
    }, 10000);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  child.stdin.end(payload);
  const code = await closed;
  expect(code).not.toBe(0);
  expect(output).toBe('');
}
it('closes malformed, oversized and overly deep input before SDK dispatch', async () => {
  await wireRejected('x'.repeat(262145));
  await wireRejected(Buffer.from([0x80, 10]));
  await wireRejected('{"jsonrpc":"2.0"');
  let nested: unknown = null;
  for (let i = 0; i < 40; i++) nested = { next: nested };
  await wireRejected(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'travel_plan', arguments: { tool: 'total-cost', input: nested } },
    }) + '\n',
  );
}, 30000);

it('closes a request burst beyond eight in-flight operations', async () => {
  const child = spawn(process.execPath, [entry], {
    cwd: tmpdir(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => {});
  let buffer = '';
  let initialized = false;
  const ended = new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('MCP concurrency guard failed'));
    }, 12000);
    child.once('close', (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (!initialized && newline !== -1 && JSON.parse(buffer.slice(0, newline)).id === 1) {
        initialized = true;
        const lines = [
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          ...Array.from({ length: 9 }, (_, index) => ({
            jsonrpc: '2.0',
            id: index + 2,
            method: 'resources/read',
            params: { uri: 'travel://agent' },
          })),
        ];
        child.stdin.write(lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
      }
      buffer = buffer.slice(-10000);
    });
  });
  child.stdin.write(
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'synthetic-burst-test', version: '1.0.0' },
      },
    }) + '\n',
  );
  const code = await ended;
  expect(initialized).toBe(true);
  expect(code).not.toBe(0);
}, 20000);
