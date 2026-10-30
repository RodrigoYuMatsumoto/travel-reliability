# Delivery evidence — 0.1.0 candidate

Verified locally on **2026-10-30**. This is executed evidence, not a claim of a
published release or production security certification.

## Implemented

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

| Check                                | Result                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Strict TypeScript / production build | PASS                                                                                                                                       |
| Vitest                               | 77 passed; 3 durable-store integration cases skipped without test services                                                                 |
| Python                               | 13 passed, including actual parser subprocess; 1 native OCR case skipped without local Tesseract                                           |
| Desktop/mobile Playwright            | 4 passed: synthetic workflow, group-allocation UI, documents/dossier/language, viewport, automated WCAG checks and private-cache exclusion |
| Formatting / Python lint             | PASS                                                                                                                                       |
| YAML syntax                          | PASS; not a container or remote workflow execution                                                                                         |
| npm audit                            | 0 known vulnerabilities at verification time                                                                                               |
| pip-audit runtime lock               | 22 packages; 0 known vulnerabilities after Pillow 13.0.0 update; installed runtime version confirmed                                       |
| Privacy scan                         | PASS over publishable files; heuristic scan plus manual review, not mathematical proof of anonymization                                    |
| CycloneDX npm SBOM                   | Generated locally                                                                                                                          |
| Dependency distribution hosts        | Public npm/PyPI only; no embedded registry credentials                                                                                     |

Two restricted read-only Claude Code reviews supplemented local analysis. Their
concrete findings were corrected and regression-tested. See [review record](REVIEW_RECORD.md).

## Outstanding external verification

- Real PostgreSQL, Redis and S3-compatible tests exist and are configured in CI;
  those services were unavailable locally.
- Native OCR and container builds are configured in CI, not executed locally.
- OIDC tests process synthetic HTTPS-provider responses through the actual client
  library; a deployed IdP still requires operator validation.
- GitHub repository creation and initial push succeeded after CLI authentication.
  The repository remains private while reference-informed improvements and
  service-backed CI are verified. No published release is claimed yet.

## Scope limits

No live fare search/status polling, automated CNPJ/Cadastur checks, purchases,
payments, message/complaint submission, identity/stay authenticity verification,
automatic FX or visual listing-truth detection. Documentary tools do not simulate
those integrations. Mobile delivery is a PWA. PDF uses standard Latin fonts;
non-Latin glyph coverage is unverified; JSON/calendar preserve Unicode text.
Fleet-wide quotas, automated key rotation and backup erasure require further
operator work. A deprecation warning remains in the local test-client dependency.

Only synthetic examples and generic command specifications enter the source
archive. Credentials, runtime data, private original folders, dependency
directories and Git internals are excluded.

## Reference-informed changes

See [comparison](COMPARISON.md): conservative model snippet screening, minimal calendar defaults, hidden-HTML exclusion, numeric/alphanumeric CNPJ checks, exact money display, readable decision tables, safe HTTP client errors, literal supplier/date/amount proposals, factual advertised/observed comparisons and concise governance. Reference scripts and data were not imported or executed.
