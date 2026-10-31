# Delivery evidence — 0.2.0

The primary product is a portable agent for the traveler's own LLM: canonical
instructions, nine commands loaded on demand, phase-aware intake, and optional
bounded stdio MCP tools. The web workbench is optional. The manual agent kit
requires no local installation; the separate skill ZIP is self-contained.

Verified locally on **2026-10-30**. This is executed evidence, not a production
security certification. Immutable source hashes, workflow URLs and sanitized
scanner reports accompany the release. The [verification workflow](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/ci.yml)
and [security workflow](https://github.com/RodrigoYuMatsumoto/travel-reliability/actions/workflows/security-audit.yml)
record the actual result for each commit; a configured job alone is not evidence.

## Implemented

Agent instructions/skill/manual kit, four fixed MCP tools, ten fixed resources
and prompts, structured intake with explicit unknowns, and an optional Windows
launcher with locked installation, directory anchoring and readiness checks.
Trip/planning schemas, generated types/OpenAPI, ten synthetic fixtures; eight
service kinds; cost/time/dependency invariants and revisions; assessment and
checklists; encrypted evidence with bounded extraction, source spans and manual
application; optional bounded/cached model proposals; disruptions, signed
webhooks and dated Brazilian rules; factual JSON/PDF/iCal and encrypted offline
exports; private reviews/moderation and route versions; pt-BR/en PWA; OIDC/RBAC,
CSRF, revocation, retention/erasure; nine UI/API/CLI tools and portable prompts.

Apache-2.0, synthetic-data license declaration, contributor/security/operations
docs, locked dependencies, CI, privacy/history scanner and source-only packager
are included. No personal travel records or reference-repository code is bundled.

## Executed checks

| Check                                | Result                                                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript / production build | PASS                                                                                                                                          |
| Vitest                               | 95 passed locally; 3 durable-service cases require PostgreSQL/Redis/S3 in CI. Includes six real MCP stdio tests                               |
| Python                               | 17 passed locally; 1 native OCR case requires Tesseract in CI. Includes four MIME/UTF-8 fuzz regressions                                      |
| Desktop/mobile Playwright            | 4 passed: synthetic workflow, group-allocation UI, documents/dossier/language, viewport, automated WCAG checks and private-cache exclusion    |
| Formatting / Python lint             | PASS                                                                                                                                          |
| Containers / remote workflow         | Both API and ingestion images built successfully on Ubuntu CI; complete verification workflow passed                                          |
| npm audit                            | 0 known vulnerabilities at verification time                                                                                                  |
| pip-audit runtime lock               | 22 packages; 0 known vulnerabilities after Pillow 13.0.0 update; installed runtime version confirmed                                          |
| Privacy scan                         | PASS over publishable files; heuristic scan plus manual review, not mathematical proof of anonymization                                       |
| CycloneDX npm SBOM                   | Generated locally                                                                                                                             |
| Dependency distribution hosts        | Public npm/PyPI only; no embedded registry credentials                                                                                        |
| SAST                                 | Semgrep CE and Bandit; payload-free summaries and fail-closed report gates. One narrowly justified Bandit B108 suppression                    |
| Authenticated DAST                   | 54 assertions passed against a fresh synthetic loopback target, including actual HTTP, Chromium rendering and raw TCP                         |
| Fuzzing                              | 18,000 TypeScript and 768 Python mutation executions over two seeds completed without remaining findings; deterministic bounded campaigns     |
| ZAP                                  | Separate bounded active scan of the unauthenticated synthetic public surface; release report requires observed active-rule traffic            |
| Audit-report gates                   | 13 persistent unittest regressions reject incomplete/malformed scanner reports, missing active traffic and untriaged medium/high alerts       |
| Installation and agent archives      | Cold/cached Windows launch from another directory, occupied-port protection and readiness passed; ZIP CRCs, per-file hashes and links checked |

Two restricted read-only Claude Code reviews supplemented local analysis. Their
concrete findings were corrected and regression-tested. See [review record](REVIEW_RECORD.md).

## Deployment verification

- Real PostgreSQL, Redis and S3-compatible tests, native OCR and both container
  builds passed in CI. These services were unavailable locally.
- OIDC tests process synthetic HTTPS-provider responses through the actual client
  library; a deployed IdP still requires operator validation.
- The GitHub repository is public, with secret scanning, push protection and a
  private vulnerability-reporting channel enabled. Release packaging requires a
  clean committed tree and a passing source/history privacy scan.

## Scope limits

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

## Reference-informed changes

See [comparison](COMPARISON.md): conservative model snippet screening, minimal calendar defaults, hidden-HTML exclusion, numeric/alphanumeric CNPJ checks, exact money display, readable decision tables, safe HTTP client errors, literal supplier/date/amount proposals, factual advertised/observed comparisons and concise governance. Reference scripts and data were not imported or executed.
