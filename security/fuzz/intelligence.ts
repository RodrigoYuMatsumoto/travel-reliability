/** Seeded bounded mutation, not coverage-guided or proof of host-model behavior. */
import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppError } from '../../api/src/errors.js';
import { plan } from '../../api/src/planning.js';
import { auditClaims } from '../../agent/provenance.js';
import { countryContext } from '../../agent/country-packs.js';
const args = process.argv.slice(2);
function option(name: string, fallback: string) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : (args[at + 1] ?? '');
}
const seed = Number(option('--seed', '20261103'));
const cases = Number(option('--cases', '1000'));
const seconds = Number(option('--seconds', '90'));
if (
  ![seed, cases, seconds].every(Number.isSafeInteger) ||
  seed < 1 ||
  cases < 100 ||
  cases > 5000 ||
  seconds < 1 ||
  seconds > 120
)
  throw new Error('FUZZ_BUDGET_REJECTED');
const output = resolve(option('--output', '.local/security-audit/fuzz/intelligence.json'));
const load = (name: string) =>
  JSON.parse(readFileSync(new URL('../../examples/' + name + '.json', import.meta.url), 'utf8'));
const bases = [
  load('loyalty-arbitrage'),
  load('multimodal-stitching'),
  load('country-pack-query'),
  { evaluatedAt: '2026-11-03T12:00:00Z', claims: [] },
  load('ground-transport'),
];
const fields = ['sourceProgram', 'origin', 'persona', 'claims', 'requestedWindow'];
let state = seed >>> 0;
const random = () => {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
};
const counts = Array.from({ length: bases.length }, () => ({ accepted: 0, rejected: 0 }));
const started = Date.now();
let executed = 0,
  failure: { caseId: number; code: string } | null = null;
for (; executed < cases; executed++) {
  if (Date.now() - started > seconds * 1000) {
    failure = { caseId: executed, code: 'DEADLINE_EXHAUSTED' };
    break;
  }
  const target = executed % bases.length,
    recipe = random() % 6;
  const value = structuredClone(bases[target]);
  let expectedRejection = true;
  if (recipe === 0) value.untrustedInstruction = 'SYNTHETIC-IGNORE-POLICY';
  else if (recipe === 1) delete value[fields[target]!];
  else if (recipe === 2) value[fields[target]!] = { invalid: random() };
  else if (recipe === 3) value.evaluatedAt = 'not-a-time-' + random();
  else if (recipe === 4) {
    expectedRejection = false;
    if (target === 0) value.sourcePoints = 14000 + (random() % 10000);
    if (target === 1) value.maxResults = 1 + (random() % 20);
    if (target === 4) value.travelerProfile.budgetMinor = random() % 1000000;
    if (target === 3)
      value.claims = [
        {
          id: 'UNTRUSTED',
          subject: 'SYNTHETIC',
          predicate: 'value',
          value: random(),
          kind: 'fact',
          evidenceRefs: ['FORGED'],
          calculationRef: null,
        },
      ];
  } else
    Object.defineProperty(value, 'hostAccessor', {
      enumerable: true,
      get() {
        throw new Error('ACCESSOR_EXECUTED');
      },
    });
  try {
    const result =
      target === 0
        ? plan('loyalty-arbitrage', value)
        : target === 1
          ? plan('multimodal-stitching', value)
          : target === 2
            ? countryContext(value)
            : target === 3
              ? auditClaims(value, [])
              : plan('ground-transport', value);
    if (expectedRejection) throw new Error('INVALID_INPUT_ACCEPTED');
    const text = JSON.stringify(result);
    if (Buffer.byteLength(text) > 262144 || text.includes('SYNTHETIC-IGNORE-POLICY'))
      throw new Error('OUTPUT_BUDGET_OR_REFLECTION');
    if ('externalCalls' in result && result.externalCalls !== 0) throw new Error('EXTERNAL_CALL');
    if (target === 3 && value.claims.length && (result as ReturnType<typeof auditClaims>).approved)
      throw new Error('UNSUPPORTED_FACT_PROMOTED');
    const stack: unknown[] = [result];
    while (stack.length) {
      const item = stack.pop();
      if (typeof item === 'number' && !Number.isSafeInteger(item)) throw new Error('UNSAFE_NUMBER');
      if (item && typeof item === 'object') stack.push(...Object.values(item));
    }
    counts[target]!.accepted++;
  } catch (error) {
    if (expectedRejection && error instanceof AppError && error.status === 422)
      counts[target]!.rejected++;
    else {
      failure = {
        caseId: executed,
        code:
          error instanceof AppError
            ? error.code
            : error instanceof Error && /^[A-Z_]+$/.test(error.message)
              ? error.message
              : 'UNEXPECTED_EXCEPTION',
      };
      break;
    }
  }
}
const fingerprint = createHash('sha256')
  .update(readFileSync(new URL(import.meta.url)))
  .digest('hex');
const report = {
  format: 'travel-reliability-intelligence-fuzz/1',
  seed,
  requestedCases: cases,
  executedCases: executed,
  counts,
  elapsedMs: Date.now() - started,
  harnessSha256: fingerprint,
  failure,
  status: failure ? 'FAIL' : 'PASS',
  scope: 'Synthetic bounded mutation; no remote accounts, provider calls or host LLM evaluation.',
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
process.exitCode = failure ? 1 : 0;
