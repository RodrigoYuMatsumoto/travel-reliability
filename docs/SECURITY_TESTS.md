# Security verification scope

Passing the automated suite is not an exhaustive security assessment or a production certification. All test inputs are synthetic. No family evidence is used.

| Boundary                         | Executed regression evidence                                                                                                                                                                                     | Limits                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Authentication and authorization | `tests/api.test.ts`, `tests/oidc.test.ts`, `tests/security.test.ts`: workspace isolation, viewer permissions, collaborator revocation, decoded routes, origin/CSRF checks, PKCE/state/nonce and replay rejection | OIDC protocol tests use synthetic provider responses; a deployed identity provider still requires validation     |
| Encrypted records and exports    | `tests/core.test.ts`: authenticated ciphertext bound to its workspace, offline bundle round trip and tampering rejection                                                                                         | No independent cryptographic implementation audit; operator key management remains essential                     |
| Evidence lifecycle               | `tests/security.test.ts`: expiry before private reads, source-owned derivative erasure, rollback and durable cleanup retry                                                                                       | Does not establish erasure from external backups or all fleet-scale race behavior                                |
| Hostile documents                | `ingest/tests/test_extract.py`, `test_html_safety.py`: passive text, hidden HTML, archive traversal, media/size/text/pixel limits                                                                                | No exhaustive parser fuzzing; arbitrary hostile PDFs and dependency exploits are not proven safe                 |
| Optional model                   | `tests/llm.test.ts`, `tests/reference-improvements.test.ts`: unsupported claims/tool calls rejected, literal source matching, bounded repairs, interrupted-run handling, conservative outbound screening         | Marker and schema checks cannot guarantee detection of every prompt injection or personal identifier             |
| Webhooks                         | `tests/security.test.ts`: workspace-specific credentials and replay receipts                                                                                                                                     | Real provider configuration and operational key rotation need separate verification                              |
| Browser and privacy              | `tests/browser/trip.spec.ts`: real browser workflow and private API data excluded from the offline cache; source/history scanner; npm SBOM omits optional author/contact fields                                  | Automated accessibility and privacy scans have limited coverage and are not proofs of compliance                 |
| Dependencies and infrastructure  | npm audit, locked Python runtime pip-audit; CI runs real PostgreSQL/Redis/S3 tests, native OCR and both container builds                                                                                         | No known advisory at audit time does not mean no vulnerability; built images are not a hardened deployed service |

## Current executed evidence

Local recheck on 2026-10-30: 77 TypeScript tests and 13 Python tests passed, plus four desktop/mobile browser tests. Three durable-service tests and one native OCR test were skipped locally because their services were unavailable; the published CI suite exercised those paths with 80 TypeScript and 14 Python passes. Both dependency audits reported no known vulnerabilities at the local recheck. The Python test-client dependency emits a deprecation warning.

The live demo was also checked over actual HTTP and Chromium at both loopback addresses, including opening the synthetic trip. These checks distinguish a working application from simply having dependencies installed in an unrelated directory.

## Not completed

Independent penetration testing, full SAST/DAST and parser fuzzing coverage, production TLS/IdP/storage configuration assessment, backup restore and backup erasure drills, fleet-wide load/abuse testing, key rotation exercises and incident-response drills. No claim that every security test has been performed is made. The application remains pre-1.0.

See [security model](SECURITY_MODEL.md), [review record](REVIEW_RECORD.md) and [delivery evidence](IMPLEMENTATION_STATUS.md) for implementation boundaries and dated CI records.
