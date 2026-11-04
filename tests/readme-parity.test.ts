import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import manifest from '../agents/manifest.json' with { type: 'json' };
import { toolIds } from '../schema/src/planning.js';

// Counts in prose are derived from the registries; a stale document fails here instead of
// silently telling the LLM that valid calculators or commands do not exist.
const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\s+/g, ' ');
const en: Record<number, string> = {
  9: 'nine',
  10: 'ten',
  11: 'eleven',
  12: 'twelve',
  13: 'thirteen',
  14: 'fourteen',
  15: 'fifteen',
  16: 'sixteen',
  17: 'seventeen',
};
const pt: Record<number, string> = {
  9: 'nove',
  10: 'dez',
  11: 'onze',
  12: 'doze',
  13: 'treze',
  14: 'catorze',
  15: 'quinze',
  16: 'dezesseis',
  17: 'dezessete',
};
const commands = manifest.commands.length;
const roles = manifest.agents.length;
const calculators = toolIds.length;
const mcpTools = (read('agent/mcp.ts').match(/server\.registerTool\(\s*'travel_/g) ?? []).length;

describe('documented counts follow the registries', () => {
  it('derives the reference counts from code', () => {
    expect(commands).toBeGreaterThan(0);
    expect(calculators).toBeGreaterThanOrEqual(9);
    expect(manifest.commands.filter((c) => c.executor === 'planning')).toHaveLength(calculators);
    expect(en[calculators] && pt[calculators] && en[mcpTools] && pt[mcpTools]).toBeTruthy();
  });

  it('keeps the English and Portuguese READMEs in step', () => {
    const readme = read('README.md');
    expect(readme).toContain(`${en[roles]} roles and ${commands} workflows`);
    expect(readme).toContain(`${commands} commands, ${en[calculators]} planning calculators`);
    expect(readme).toContain(`${capitalize(en[calculators]!)} deterministic calculators`);
    expect(readme).not.toMatch(/\bNine deterministic tools\b/);
    const portuguese = read('README.pt-BR.md');
    expect(portuguese).toContain(`${pt[roles]} papéis e ${commands} fluxos`);
    expect(portuguese).toContain(`${capitalize(pt[calculators]!)} calculadores determinísticos`);
    expect(portuguese).toContain(
      `${pt[calculators]} calculadores de planejamento, ${commands - calculators - 1} workflows de instrução`,
    );
  });

  it('keeps the documents read by the LLM in step', () => {
    expect(read('prompts/README.md')).toContain(`**${commands} comandos e ${pt[roles]} papéis**`);
    expect(read('prompts/README.md')).toContain(`dos ${pt[calculators]} IDs de calculadores`);
    expect(read('agents/README.md')).toContain(`anuncia ${pt[mcpTools]} ferramentas`);
    expect(read('agents/README.md')).toContain(`expõe os ${commands} comandos`);
    expect(read('agents/TRAVEL_AGENT.md')).toContain(`calcula os ${pt[calculators]} contratos`);
    expect(read('skills/travel-agent/SKILL.md')).toContain(`${commands} comandos`);
    const catalog = read('docs/AGENT_CATALOG.md');
    expect(catalog).toContain(`**${pt[roles]} papéis e ${commands} comandos**`);
    expect(catalog).toContain(`anuncia ${pt[mcpTools]} tools`);
    expect(catalog).toContain(`totalizando ${1 + roles + commands}`);
    for (const id of toolIds) expect(catalog).toContain(`\`${id}\``);
  });
});

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
