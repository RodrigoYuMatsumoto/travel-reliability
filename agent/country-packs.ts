import { countryPackQuerySchema } from '../schema/src/intelligence.js';
import {
  digest,
  evidenceStatus,
  receipt,
  validatePassive,
  type EvidenceReference,
} from './provenance.js';
import { requireCondition } from '../api/src/errors.js';
import { sensitiveTextReasons } from '../api/src/privacy.js';
interface Scope {
  country: string;
  subdivision: string | null;
  municipality: string | null;
}
interface PackClaim {
  id: string;
  key: string;
  statement: string;
  context: string;
  value: unknown;
  kind: 'fact' | 'guidance';
  evidenceRefs: string[];
  validFrom: string;
  validTo: string;
  personas: string[];
}
interface Pack {
  version: string;
  scope: Scope;
  synthetic: boolean;
  evidence: EvidenceReference[];
  persona?: string;
  [key: string]: unknown;
}
const categories = [
  'mobility_apps',
  'food_and_delivery_apps',
  'payment_and_connectivity',
  'safety_and_sanitary',
  'communication_matrix',
  'negotiation_and_hierarchy',
  'rapport_and_taboos',
  'corporate_gifting_and_dining',
];
const matches = (pack: Scope, query: Scope) =>
  pack.country === query.country &&
  (pack.subdivision === null || pack.subdivision === query.subdivision) &&
  (pack.municipality === null || pack.municipality === query.municipality);
function noPersonalData(value: unknown): boolean {
  if (typeof value === 'string' || typeof value === 'number')
    return (
      sensitiveTextReasons(String(value)).filter((reason) => reason !== 'URL_REQUIRES_REDACTION')
        .length === 0
    );
  if (Array.isArray(value)) return value.every(noPersonalData);
  if (value && typeof value === 'object') return Object.values(value).every(noPersonalData);
  return true;
}
/** Input pack evidence is descriptive, never an authority grant to the host. */
export function countryContext(
  supplied: unknown,
  trustedRegistry: readonly EvidenceReference[] = [],
) {
  validatePassive(countryPackQuerySchema, supplied);
  const input = supplied as { evaluatedAt: string; scope: Scope; persona: string; packs: Pack[] };
  requireCondition(
    input.scope.municipality === null || input.scope.subdivision !== null,
    'COUNTRY_HIERARCHY_REQUIRED',
    422,
  );
  const rows: Array<{
    packVersion: string;
    category: string;
    level: string;
    claim: PackClaim;
    status: string;
  }> = [];
  const ids = new Set<string>();
  const now = Date.parse(input.evaluatedAt);
  requireCondition(Number.isFinite(now), 'INVALID_EVALUATION_TIME', 422);
  for (const pack of input.packs) {
    requireCondition(
      pack.scope.municipality === null || pack.scope.subdivision !== null,
      'COUNTRY_HIERARCHY_REQUIRED',
      422,
    );
    if (!matches(pack.scope, input.scope) || (pack.persona && pack.persona !== input.persona))
      continue;
    const level =
      pack.scope.municipality !== null
        ? 'municipality'
        : pack.scope.subdivision !== null
          ? 'subdivision'
          : 'country';
    for (const category of categories) {
      if (!(category in pack)) continue;
      for (const claim of pack[category] as PackClaim[]) {
        requireCondition(
          noPersonalData([claim.statement, claim.context, claim.value]),
          'PERSONAL_DATA_NOT_ALLOWED',
          422,
        );
        requireCondition(!ids.has(claim.id), 'DUPLICATE_PACK_CLAIM', 422);
        ids.add(claim.id);
        requireCondition(
          Date.parse(claim.validFrom) < Date.parse(claim.validTo),
          'PACK_INTERVAL_REJECTED',
          422,
        );
        if (!claim.personas.includes(input.persona)) continue;
        const active = Date.parse(claim.validFrom) <= now && now < Date.parse(claim.validTo);
        const supported =
          !pack.synthetic &&
          claim.kind === 'fact' &&
          claim.evidenceRefs.length > 0 &&
          claim.evidenceRefs.every((id) => {
            const reference = trustedRegistry.find((r) => r.id === id);
            return (
              evidenceStatus(reference, input.evaluatedAt) === 'supported' &&
              reference!.assertion.subject === claim.id &&
              reference!.assertion.predicate === claim.key &&
              digest(reference!.assertion.value) ===
                digest({ statement: claim.statement, context: claim.context, value: claim.value })
            );
          });
        rows.push({
          packVersion: pack.version,
          category,
          level,
          claim,
          status: !active
            ? 'expired'
            : supported
              ? 'documented'
              : claim.kind === 'guidance'
                ? 'guidance'
                : 'unverified_hypothesis',
        });
      }
    }
  }
  const conflicts = [
    ...new Set(rows.filter((r) => r.status !== 'expired').map((r) => r.claim.key)),
  ].filter(
    (key) =>
      new Set(
        rows
          .filter((r) => r.claim.key === key && r.status !== 'expired')
          .map((r) => digest(r.claim.value)),
      ).size > 1,
  );
  const result = {
    mode: 'documentary' as const,
    scope: input.scope,
    persona: input.persona,
    claims: rows.map((row) => ({
      ...row,
      status:
        conflicts.includes(row.claim.key) && row.status !== 'expired' ? 'conflicting' : row.status,
      displayMarker:
        row.status === 'documented' && !conflicts.includes(row.claim.key)
          ? null
          : '[UNVERIFIED_HYPOTHESIS — HUMAN CHECK REQUIRED]',
    })),
    conflicts,
    factsVerified: false,
    externalCalls: 0,
    limits:
      'No automatic municipal override, provider ranking, nationality stereotype, legal rule execution, safety guarantee or source authentication. Caller-supplied reviewed flags do not enroll evidence in the operator registry.',
  };
  return {
    ...result,
    calculationReceipt: receipt('country-context', input, result, input.evaluatedAt),
  };
}
