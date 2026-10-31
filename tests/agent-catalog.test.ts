import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { catalog, catalogSchema, listCatalog, validateCatalog } from '../agent/catalog.js';
import { workflowSchema, prepareWorkflow } from '../agent/workflow.js';
import { toolIds } from '../schema/src/planning.js';
import coverage from '../agents/coverage.json' with { type: 'json' };

describe('source-derived portable catalog', () => {
  it('covers every recovered source function and all runtime invocations with material instructions', () => {
    expect(coverage.requirements).toHaveLength(43);
    expect(coverage.sources).toHaveLength(18);
    expect(coverage.logisticsChecks).toHaveLength(13);
    for (const requirement of coverage.requirements) {
      expect(requirement.sources.length).toBeGreaterThan(0);
      for (const workflowId of requirement.workflowIds) {
        const command = catalog.commands.find((row) => row.id === workflowId);
        expect(command, requirement.id).toBeDefined();
        const content = readFileSync(
          fileURLToPath(new URL('../' + command!.path, import.meta.url)),
          'utf8',
        );
        expect(content.length).toBeGreaterThan(1000);
        expect(content).toContain(command!.id);
      }
    }
    for (const role of catalog.agents)
      expect(statSync(fileURLToPath(new URL('../' + role.path, import.meta.url))).isFile()).toBe(
        true,
      );
  });
  it('retains the nine calculator contracts while exposing workflows and a separate settlement executor', () => {
    expect(catalog.agents).toHaveLength(8);
    expect(catalog.commands).toHaveLength(52);
    expect(
      catalog.commands.filter((row) => row.executor === 'planning').map((row) => row.calculatorId),
    ).toEqual([...toolIds]);
    expect(catalog.commands.find((row) => row.id === 'expense-settlement')).toMatchObject({
      calculatorId: null,
      executor: 'settlement',
    });
    expect(catalog.agents.filter((row) => row.mode === 'meta').map((row) => row.id)).toEqual([
      'ecosystem-architect',
    ]);
  });
  it('filters and paginates compact metadata without loading prompt bodies', () => {
    const hotels = listCatalog({ domain: 'lodging', limit: 20 });
    expect(hotels.items.map((row) => row.id)).toContain('compare-lodging');
    expect(hotels.items.map((row) => row.id)).not.toContain('airports');
    expect(JSON.stringify(hotels)).not.toContain('requiredInputs');
    const ids: string[] = [];
    let cursor: number | null = 0;
    do {
      const page = listCatalog({ cursor, limit: 7 });
      ids.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor;
    } while (cursor !== null);
    expect(new Set(ids).size).toBe(catalog.commands.length);
    expect(ids).toHaveLength(catalog.commands.length);
    expect(() => listCatalog({ limit: 0 })).toThrow('INVALID_CATALOG_QUERY');
    expect(() => listCatalog({ domain: 'lodging', approved: true })).toThrow(
      'INVALID_CATALOG_QUERY',
    );
  });
  it('rejects traversal, duplicate entries, undefined owners and lost legacy calculators', () => {
    const badPath = structuredClone(catalog);
    badPath.commands[0]!.path = '../../private.md';
    expect(() => validateCatalog(badPath)).toThrow('INVALID_AGENT_CATALOG');
    const duplicate = structuredClone(catalog);
    duplicate.commands.push(duplicate.commands[0]!);
    expect(() => validateCatalog(duplicate)).toThrow('DUPLICATE_CATALOG_ENTRY');
    const owner = structuredClone(catalog);
    owner.commands[0]!.agentId = 'missing-agent';
    expect(() => validateCatalog(owner)).toThrow('INCONSISTENT_CATALOG_REFERENCE');
    const missing = structuredClone(catalog);
    missing.commands = missing.commands.filter((row) => row.id !== 'flex-dates');
    expect(() => validateCatalog(missing)).toThrow('MISSING_LEGACY_CALCULATOR');
    expect(() => new Ajv2020({ strict: true }).compile(catalogSchema)).not.toThrow();
  });
  it('prepares all thirteen logistics checks as unperformed, not as verified conclusions', () => {
    const prepared = prepareWorkflow({
      tripKey: 'logistics-1',
      workflowId: 'audit-logistics',
      language: 'en',
    });
    expect(prepared.checklist).toHaveLength(14);
    expect(prepared.checklist.every((row) => row.status === 'not_performed')).toBe(true);
    expect(prepared.checklist.map((row) => row.expected)).toEqual(
      expect.arrayContaining(coverage.logisticsChecks.map((row) => row.label)),
    );
    expect(prepared.effects).toMatchObject({
      externalCalls: 0,
      persistenceWrites: 0,
      permissionsGranted: false,
    });
    expect(workflowSchema.additionalProperties).toBe(false);
  });
});
