# Delivery evidence — 0.1.0

Verified locally and on GitHub on **2026-10-30**. This is executed evidence,
not a production security certification. Service-backed CI run **40998099117**
passed on code commit `9b9075409fed1d622d11ba40b778290b8deb4fc8`.

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
| Vitest                               | 80 passed in CI, including real PostgreSQL/Redis/S3; locally 77 passed and 3 skipped without services                                      |
| Python                               | 14 passed in CI, including native OCR and actual parser subprocess; locally 13 passed and 1 skipped without Tesseract                      |
| Desktop/mobile Playwright            | 4 passed: synthetic workflow, group-allocation UI, documents/dossier/language, viewport, automated WCAG checks and private-cache exclusion |
| Formatting / Python lint             | PASS                                                                                                                                       |
| Containers / remote workflow         | Both API and ingestion images built successfully on Ubuntu CI; complete verification workflow passed                                       |
| npm audit                            | 0 known vulnerabilities at verification time                                                                                               |
| pip-audit runtime lock               | 22 packages; 0 known vulnerabilities after Pillow 13.0.0 update; installed runtime version confirmed                                       |
| Privacy scan                         | PASS over publishable files; heuristic scan plus manual review, not mathematical proof of anonymization                                    |
| CycloneDX npm SBOM                   | Generated locally                                                                                                                          |
| Dependency distribution hosts        | Public npm/PyPI only; no embedded registry credentials                                                                                     |

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
