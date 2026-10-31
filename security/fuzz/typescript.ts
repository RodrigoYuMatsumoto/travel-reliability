/** Deterministic mutation/property campaign in disposable bounded Node workers. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative } from 'node:path';
import { addMinor } from '../../api/src/money.js';
import { allocate, plan } from '../../api/src/planning.js';
import { literalFacts } from '../../api/src/literal-facts.js';
import { extractText } from '../../api/src/ingestion.js';
import { instant, validateTrip } from '../../api/src/validation.js';
import { validateSuggestions } from '../../api/src/llm.js';
import { AppError } from '../../api/src/errors.js';
import { planningExamples } from '../../web/src/planning-examples.js';

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
] as const;
type Target = (typeof targets)[number];
type Case = { id: number; target: Target; seed: number; variant: number };
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

function exercise(item: Case) {
  const next = random(item.seed);
  if (item.target === 'money') {
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
  globalThis.fetch = async () => {
    throw new Error('FUZZ_NETWORK_ATTEMPT');
  };
  const input: Case[] = JSON.parse(readFileSync(0, 'utf8'));
  for (const item of input) {
    console.log(JSON.stringify({ phase: 'start', id: item.id, target: item.target }));
    const start = performance.now();
    let outcome = 'accepted',
      code: string | undefined;
    try {
      exercise(item);
    } catch (error) {
      if (error instanceof AppError) {
        outcome = 'rejected';
        code = error.code;
      } else {
        outcome = 'finding';
        code =
          error instanceof Error && /^FUZZ_[A-Z_]+$/.test(error.message)
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
  const count = Number(flag('--cases', '9000'));
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
  const safe = relative(resolve(root, '.local/security-audit/fuzz'), output);
  ensure(safe.length > 0 && !safe.startsWith('..') && !safe.includes(':'), 'INVALID_REPORT_PATH');
  mkdirSync(dirname(output), { recursive: true });
  const sourceNames = [
    'api/src/money.ts',
    'api/src/planning.ts',
    'api/src/validation.ts',
    'api/src/llm.ts',
    'api/src/ingestion.ts',
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
      resolve(dirname(output), `ts-case-${finding.id}.json`),
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
