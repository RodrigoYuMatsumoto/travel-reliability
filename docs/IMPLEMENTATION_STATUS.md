# Delivery evidence — 0.4.0 candidate

## Current local checkpoint — 2026-10-31

The international catalog contains **eleven roles, 66 commands, thirteen MCP
tools and 78 fixed resources/prompts**, including compatibility aliases. The
traveler chooses the LLM host; instructions, model access and real tool
permissions remain separate. Original code, schemas, prompts and documentation
adopt MIT from v0.4.0; earlier releases keep their published terms. See
[licensing](LICENSING.md) and [publication boundaries](PUBLICATION_BOUNDARY.md).

Implemented additions include BCP 47 locale validation and global/multimodal
context; source-bound booking reconciliation; bounded connector reads; an
operator-selected document workspace with digest-bound CLI application and
rollback; complete extension drafts without installation; literal MIME parsing;
and explicit PDF font coverage checks. The default MCP is offline. Selected
Gmail messages and the document workspace require the separate
[operator profile](OPERATOR_PROFILE.md). There is no MCP apply/rollback tool,
arbitrary-path argument, account-write tool or universal provider connector.

JSON/calendar preserve UTF-8. PDF preflights every rendered character against
the operator's local font, or standard WinAnsi coverage without one. Missing
glyphs fail explicitly. Glyph coverage does not certify bidirectional layout,
complex-script shaping or typographic quality. See [Unicode exports](UNICODE_EXPORTS.md).

The following checks were executed against the local v0.4 candidate. At this
checkpoint, v0.4 remote CI and release publication had **not** been executed;
local success is not a remote check result. The completed per-commit
[verification](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/ci.yml)
and [security](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/security-audit.yml)
runs, archived reports and release manifests remain the authority for published
commit/asset verification.

| Executed local check                   | Result and scope                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Strict TypeScript and production build | PASS                                                                                                   |
| TypeScript tests                       | 363 passed; three PostgreSQL/Redis/S3 cases skipped locally and reserved for provisioned CI services   |
| Python ingest tests                    | 28 passed; one native OCR case skipped locally and reserved for CI with Tesseract                      |
| Desktop/mobile Playwright              | Four passed on an isolated test port                                                                   |
| Audit and package report gates         | Twenty-two standard-library unittest regressions passed                                                |
| Authenticated DAST                     | 54 assertions passed against a new synthetic loopback target                                           |
| Legacy mutation campaigns              | 13,000 TypeScript and 384 document-ingest case executions passed                                       |
| Ecosystem mutation campaigns           | 2,000 TypeScript and 384 MIME case executions passed                                                   |
| Formatting and Python lint             | PASS                                                                                                   |
| Dependency advisories                  | npm audit and locked Python runtime pip-audit reported zero known vulnerabilities at verification time |
| Current-source and history privacy     | PASS; heuristic scan plus manual review, not proof of complete anonymization                           |

Final portable-archive verification, exact-commit SAST/ZAP,
service-backed CI, both repository integrations and release/download verification
are separate publication gates. They were still pending at this checkpoint;
configured jobs alone do not establish completion. Fuzzing is bounded and
deterministic, not exhaustive or coverage-guided. See
[ecosystem security evidence](SECURITY_ECOSYSTEM.md).

The same-family runtime review confirmed and replayed corrections for mutable
connector requests, non-finite observation dates, currency-conflicting amounts,
working-directory interpreter selection and unknown supplier-registration
status. A separate regression binds Gmail records to both trip and record IDs.
GitHub review also corrected canonicalization before MIME-field deduplication
and isolated duplicate source references to the rejecting adapter read.
These reviews do not establish model-family independence, B.9 verification,
behavioral compliance of every host LLM or universal prompt-injection immunity.
All fixtures are synthetic; no real account or personal travel archive was used
for these checks.

## Historical v0.3 local delivery record

The following dated record describes the earlier v0.3 checkpoint. Its counts,
license and runtime limitations are historical, not the current v0.4 contract.

The primary product is a portable agent for the traveler's own LLM: canonical
instructions, eight roles and 52 commands loaded on demand, phase-aware intake, and optional
bounded stdio MCP tools. The web workbench is optional. The manual agent kit
requires no local installation; the separate skill ZIP is self-contained.

Verified locally on **2026-10-31**. This is executed evidence, not a production
security certification. Immutable source hashes, workflow URLs and sanitized
scanner reports accompany the release. The [verification workflow](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/ci.yml)
and [security workflow](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/security-audit.yml)
record the actual result for each commit; a configured job alone is not evidence.

### Implemented

Agent instructions/skill/manual kit, seven fixed MCP tools, 61 fixed resources
and prompts (including legacy aliases), validated catalog/coverage, stateless
workflow checkpoints and known-expense settlement with prior-payment reconciliation.
Structured intake preserves explicit unknowns and routes by service domain. An optional Windows
launcher with locked installation, directory anchoring and readiness checks.
Trip/planning schemas, generated types/OpenAPI, twelve synthetic JSON fixtures; eight
service kinds; cost/time/dependency invariants and revisions; assessment and
checklists; encrypted evidence with bounded extraction, source spans and manual
application; optional bounded/cached model proposals; disruptions, signed
webhooks and dated Brazilian rules; factual JSON/PDF/iCal and encrypted offline
exports; private reviews/moderation and route versions; pt-BR/en PWA; OIDC/RBAC,
CSRF, revocation, retention/erasure; nine UI/API/CLI tools and portable prompts.

Apache-2.0, synthetic-data license declaration, contributor/security/operations
docs, locked dependencies, CI, privacy/history scanner and source-only packager
are included. No personal travel records or reference-repository code is bundled.

### Executed checks

| Check                                | Result                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript / production build | PASS                                                                                                                                          |
| Vitest                               | 145 passed locally; 3 durable-service cases require PostgreSQL/Redis/S3 in CI. Includes seven real MCP stdio tests and all catalog resources  |
| Python                               | 17 passed locally; 1 native OCR case requires Tesseract in CI. Includes four MIME/UTF-8 fuzz regressions                                      |
| Desktop/mobile Playwright            | 4 passed: synthetic workflow, group-allocation UI, documents/dossier/language, viewport, automated WCAG checks and private-cache exclusion    |
| Formatting / Python lint             | PASS                                                                                                                                          |
| Containers / remote workflow         | Required CI provisions persistent services and builds both images; completed per-commit runs and release reports record the actual result     |
| npm audit                            | 0 known vulnerabilities at verification time                                                                                                  |
| pip-audit runtime lock               | 22 packages; 0 known vulnerabilities after Pillow 13.0.0 update; installed runtime version confirmed                                          |
| Privacy scan                         | PASS over publishable files; heuristic scan plus manual review, not mathematical proof of anonymization                                       |
| CycloneDX npm SBOM                   | Generated locally                                                                                                                             |
| Dependency distribution hosts        | Public npm/PyPI only; no embedded registry credentials                                                                                        |
| SAST                                 | Semgrep CE and Bandit; payload-free summaries and fail-closed report gates. One narrowly justified Bandit B108 suppression                    |
| Authenticated DAST                   | 54 assertions passed against a fresh synthetic loopback target, including actual HTTP, Chromium rendering and raw TCP                         |
| Fuzzing                              | v0.3: 26,000 TypeScript executions across two seeds/13 families, no remaining findings; prior Python campaign: 768 cases, runtime unchanged   |
| ZAP                                  | Separate bounded active scan of the unauthenticated synthetic public surface; release report requires observed active-rule traffic            |
| Audit-report gates                   | 13 persistent unittest regressions reject incomplete/malformed scanner reports, missing active traffic and untriaged medium/high alerts       |
| Installation and agent archives      | Cold/cached Windows launch from another directory, occupied-port protection and readiness passed; ZIP CRCs, per-file hashes and links checked |

The v0.3 source audit, static semantic review of all 52 commands/eight roles and
the corrected prior-settlement defect are recorded in [agent audit](AGENT_AUDIT.md).
These reviews do not establish model-family independence or LLM execution.
Earlier restricted Claude Code reviews concern the v0.1 baseline; see [review record](REVIEW_RECORD.md).

### Deployment verification

- CI provisions real PostgreSQL, Redis, S3-compatible storage and native OCR, and
  builds both images. The release's completed workflow records prove the tested
  commit; those services were unavailable locally.
- OIDC tests process synthetic HTTPS-provider responses through the actual client
  library; a deployed IdP still requires operator validation.
- The GitHub repository is public, with secret scanning, push protection and a
  private vulnerability-reporting channel enabled. Release packaging requires a
  clean committed tree and a passing source/history privacy scan.

### Scope limits

The host provides the LLM and authorized research capabilities; instructions do
not create inventory, browsing, account access or permissions. MCP tools make no
network requests and accept no arbitrary private file path. Unknown required
costs remain unknown. Original evidence and traveler identity data remain private.

No live fare search/status polling, automated CNPJ/Cadastur checks, purchases,
payments, message/complaint submission, identity/stay authenticity verification,
automatic FX or visual listing-truth detection. Documentary tools do not simulate
those integrations. Mobile delivery is a PWA. PDF uses standard Latin fonts;
non-Latin glyph coverage is unverified; JSON/calendar preserve Unicode text.
Fleet-wide quotas, automated key rotation and backup erasure require further
operator work. A deprecation warning remains in the local test-client dependency.

The npm CycloneDX export omits optional author/contact fields in a documented
privacy projection while retaining package versions, hashes, licenses and references.

Only synthetic examples and generic command specifications enter the source
archive. Credentials, runtime data, private original folders, dependency
directories and Git internals are excluded.

### Reference-informed changes

See [comparison](COMPARISON.md): conservative model snippet screening, minimal calendar defaults, hidden-HTML exclusion, numeric/alphanumeric CNPJ checks, exact money display, readable decision tables, safe HTTP client errors, literal supplier/date/amount proposals, factual advertised/observed comparisons and concise governance. Reference scripts and data were not imported or executed.
