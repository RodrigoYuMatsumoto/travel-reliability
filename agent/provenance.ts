import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AppError, requireCondition } from '../api/src/errors.js';
import { claimOutputSchema, evidenceReferenceSchema } from '../schema/src/intelligence.js';

export function passiveJson(value: unknown): void {
  const queue = [{ value, depth: 0 }];
  let count = 0;
  while (queue.length) {
    const item = queue.pop()!;
    requireCondition(++count <= 25000 && item.depth <= 32, 'PASSIVE_DATA_LIMIT', 422);
    const current = item.value;
    if (current === null || typeof current === 'boolean') continue;
    if (typeof current === 'number') {
      requireCondition(Number.isFinite(current), 'PASSIVE_DATA_REQUIRED', 422);
      continue;
    }
    if (typeof current === 'string') {
      requireCondition(current.length <= 20000, 'PASSIVE_DATA_LIMIT', 422);
      continue;
    }
    requireCondition(!types.isProxy(current), 'PASSIVE_DATA_REQUIRED', 422);
    requireCondition(
      typeof current === 'object' &&
        current !== null &&
        (Array.isArray(current) ||
          Object.getPrototypeOf(current) === Object.prototype ||
          Object.getPrototypeOf(current) === null),
      'PASSIVE_DATA_REQUIRED',
      422,
    );
    for (const key of Reflect.ownKeys(current)) {
      requireCondition(
        typeof key === 'string' && !['__proto__', 'constructor', 'prototype'].includes(key),
        'PASSIVE_DATA_REQUIRED',
        422,
      );
      const property = Object.getOwnPropertyDescriptor(current, key)!;
      requireCondition('value' in property, 'PASSIVE_DATA_REQUIRED', 422);
      queue.push({ value: property.value, depth: item.depth + 1 });
    }
  }
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  return value;
}
export function digest(value: unknown): string {
  passiveJson(value);
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
const ajv = new Ajv2020({ strict: true, allErrors: false, coerceTypes: false });
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
export function validatePassive(schema: object, value: unknown): void {
  passiveJson(value);
  requireCondition(ajv.compile(schema)(value), 'INTELLIGENCE_SCHEMA_REJECTED', 422);
}
export interface EvidenceReference {
  id: string;
  sourceUrl: string;
  sourceSha256: string;
  retrievedAt: string;
  reviewAfter: string;
  state: 'operator_asserted' | 'source_captured' | 'reviewed' | 'conflicting';
  sourceSpan: { quote: string; locator: string };
  assertion: { subject: string; predicate: string; value: unknown };
}
export interface CalculationReceipt {
  format: 'travel-reliability-calculation-receipt/1';
  calculatorId: string;
  algorithmVersion: string;
  inputSha256: string;
  outputSha256: string;
  datasetSha256: string | null;
  evaluatedAt: string;
}
export function receipt(
  calculatorId: string,
  input: unknown,
  output: unknown,
  evaluatedAt: string,
  dataset: unknown = null,
): CalculationReceipt {
  return {
    format: 'travel-reliability-calculation-receipt/1',
    calculatorId,
    algorithmVersion: '1.0.0',
    inputSha256: digest(input),
    outputSha256: digest(output),
    datasetSha256: dataset === null ? null : digest(dataset),
    evaluatedAt,
  };
}
export function evidenceStatus(
  reference: EvidenceReference | undefined,
  evaluatedAt: string,
): 'supported' | 'unverified' | 'conflicting' | 'expired' {
  if (!reference) return 'unverified';
  validatePassive(evidenceReferenceSchema, reference);
  const now = Date.parse(evaluatedAt),
    observed = Date.parse(reference.retrievedAt),
    end = Date.parse(reference.reviewAfter);
  requireCondition(Number.isFinite(now) && end > observed, 'INVALID_EVIDENCE_INTERVAL', 422);
  if (reference.state === 'conflicting') return 'conflicting';
  if (observed > now || now > end) return 'expired';
  return reference.state === 'reviewed' ? 'supported' : 'unverified';
}
export interface Claim {
  id: string;
  subject: string;
  predicate: string;
  value: unknown;
  kind: 'fact' | 'calculation' | 'guidance' | 'hypothesis';
  evidenceRefs: string[];
  calculationRef: string | null;
}
/** Registry is operator-owned, never supplied by an untrusted output under review. */
export function auditClaims(
  input: unknown,
  registry: readonly EvidenceReference[],
  calculations: ReadonlyMap<
    string,
    { receipt: CalculationReceipt; input: unknown; output: unknown }
  > = new Map(),
) {
  validatePassive(claimOutputSchema, input);
  const packet = input as { evaluatedAt: string; claims: Claim[] };
  requireCondition(Number.isFinite(Date.parse(packet.evaluatedAt)), 'INVALID_EVALUATION_TIME', 422);
  requireCondition(
    new Set(registry.map((r) => r.id)).size === registry.length,
    'DUPLICATE_EVIDENCE_ID',
    422,
  );
  requireCondition(
    new Set(packet.claims.map((c) => c.id)).size === packet.claims.length,
    'DUPLICATE_CLAIM_ID',
    422,
  );
  const results = packet.claims.map((claim) => {
    if (claim.kind === 'hypothesis' || claim.kind === 'guidance')
      return { id: claim.id, status: claim.kind, factsVerified: false };
    if (claim.kind === 'calculation') {
      const run = claim.calculationRef ? calculations.get(claim.calculationRef) : undefined;
      const valid =
        !!run &&
        claim.subject === run.receipt.calculatorId &&
        claim.predicate === 'result' &&
        run.receipt.evaluatedAt === packet.evaluatedAt &&
        run.receipt.inputSha256 === digest(run.input) &&
        run.receipt.outputSha256 === digest(run.output) &&
        digest(claim.value) === digest(run.output);
      return {
        id: claim.id,
        status: valid ? 'calculation_bound' : 'blocked',
        factsVerified: false,
      };
    }
    const valid =
      claim.evidenceRefs.length > 0 &&
      claim.evidenceRefs.every((id) => {
        const record = registry.find((item) => item.id === id);
        return (
          evidenceStatus(record, packet.evaluatedAt) === 'supported' &&
          record!.assertion.subject === claim.subject &&
          record!.assertion.predicate === claim.predicate &&
          digest(record!.assertion.value) === digest(claim.value)
        );
      });
    return { id: claim.id, status: valid ? 'documented' : 'blocked', factsVerified: false };
  });
  return {
    mode: 'documentary' as const,
    evaluatedAt: packet.evaluatedAt,
    approved: results.every((row) => row.status !== 'blocked'),
    results,
    limits:
      'Integrity and exact structured assertion binding do not authenticate the source or prove real-world truth. External free-form host responses are outside this gate.',
  };
}
export function safeInteger(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw new AppError('INTELLIGENCE_INTEGER_OVERFLOW', 422);
  return result;
}
