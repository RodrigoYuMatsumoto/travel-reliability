import { expect, it } from 'vitest';
import query from '../examples/country-pack-query.json' with { type: 'json' };
import { countryContext } from '../agent/country-packs.js';
import { auditClaims, safeInteger, type EvidenceReference } from '../agent/provenance.js';
import { multimodalStitching } from '../api/src/multimodal-stitching.js';
import { multimodalExample } from '../web/src/intelligence-examples.js';

it('binds cultural prose, context and typed values to the same trusted assertion', () => {
  const input = structuredClone(query);
  const pack = input.packs[0]!;
  pack.synthetic = false;
  const claim = pack.communication_matrix[0]!;
  Object.assign(claim, { kind: 'fact', evidenceRefs: ['E-SYNTHETIC'] });
  const reference: EvidenceReference = {
    id: 'E-SYNTHETIC',
    sourceUrl: 'https://example.invalid/synthetic',
    sourceSha256: 'a'.repeat(64),
    retrievedAt: '2026-11-01T01:00:00Z',
    reviewAfter: '2026-11-20T00:00:00Z',
    state: 'reviewed',
    sourceSpan: { quote: 'Synthetic claim only.', locator: 'synthetic:1' },
    assertion: {
      subject: claim.id,
      predicate: claim.key,
      value: { statement: claim.statement, context: claim.context, value: claim.value },
    },
  };
  expect(countryContext(input, [reference]).claims[0]!.status).toBe('documented');
  claim.statement = 'Changed prose with the same structured value.';
  expect(countryContext(input, [reference]).claims[0]!.status).toBe('unverified_hypothesis');
  expect(countryContext(input).claims[0]!.status).toBe('unverified_hypothesis');
});
it('rejects credential-shaped pack data and invalid hierarchical scopes', () => {
  const input = structuredClone(query);
  input.packs[0]!.communication_matrix[0]!.statement = 'Contact synthetic.person@example.com';
  expect(() => countryContext(input)).toThrow('PERSONAL_DATA_NOT_ALLOWED');
  const bad = structuredClone(query) as unknown as Record<string, unknown>;
  bad.persona = 'unrestricted';
  expect(() => countryContext(bad)).toThrow('INTELLIGENCE_SCHEMA_REJECTED');
});
it('rejects overflow and non-parseable evaluation times even for guidance-only packets', () => {
  expect(() => safeInteger(BigInt(Number.MAX_SAFE_INTEGER) + 1n)).toThrow(
    'INTELLIGENCE_INTEGER_OVERFLOW',
  );
  expect(() => auditClaims({ evaluatedAt: '2016-12-31T23:59:60Z', claims: [] }, [])).toThrow();
});
it('refuses a node/leg timezone contradiction and rejects invented cultural fields', () => {
  const input = structuredClone(multimodalExample);
  input.nodes[0]!.timeZone = 'Asia/Tokyo';
  expect(() => multimodalStitching(input)).toThrow('NODE_TIME_ZONE_MISMATCH');
  expect(() =>
    countryContext({ ...query, packs: [{ ...query.packs[0], automaticStereotype: true }] }),
  ).toThrow('INTELLIGENCE_SCHEMA_REJECTED');
});
