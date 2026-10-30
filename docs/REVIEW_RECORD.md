# Review record

Date: 2026-10-29. Two restricted read-only Claude Code terminal reviews
supplemented local analysis. Private case documents were excluded. This is not
an independent penetration test, certification or guarantee.

| Finding                             | Response / regression evidence                                                                                                                      |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoded routes and CSRF             | Authorize registered decoded routes; recheck membership/origin/CSRF inside workspace mutations; encoded-route regression                            |
| Expiry and source-owned derivatives | Purge before reads; redact linked fields and affected history; preserve unrelated values; expiry/equal-value/provenance regressions                 |
| Storage deletion failure            | Durable outbox and retry receipt; failure/recovery regression                                                                                       |
| Unbounded uploads/parsing/exports   | Admission, queue, time/page/pixel/output bounds and async bounded KDF; parser/export checks; fleet quotas deferred                                  |
| Webhook scope and replay            | Workspace-specific key, context HMAC and durable receipt; cross-workspace/replay regression                                                         |
| OIDC and membership                 | Recover failed discovery, atomic one-use state, secure sessions and revocation; protocol/state/nonce/replay/role regressions                        |
| Prototype tool names                | Own-key validation; constructor/**proto**/toString/hasOwnProperty rejection cases                                                                   |
| False quoted savings                | Validity, freshness, equivalent trip type/nights/scope; expired/stale/future/reduced-stay/dropped-return/promotion regressions                      |
| Model negation stripping            | Value and quote equal the entire displayed snippet; non-refundable cannot become refundable                                                         |
| Interrupted model lease             | Review-required state without another automatic paid attempt; durable interrupted-run regression                                                    |
| Monetary/allocation errors          | Integer arithmetic, overflow rejection, exact cent reconciliation, conservative interval bounds, beneficiary-only shares and per-household deficits |
| Native image advisories             | Pillow 13.0.0, fresh environment, version verification, Python tests and clean runtime dependency audit at the verification date                    |

Real infrastructure tests, native OCR and container builds subsequently passed
on GitHub CI, as recorded in IMPLEMENTATION_STATUS.md. Deployed identity-provider
validation, fleet-scale races and independent penetration testing remain outside
that evidence. Passing regressions does not establish absence of other vulnerabilities.
