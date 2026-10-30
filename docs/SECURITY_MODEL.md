# Trust boundaries and privacy

## Threats and controls

| Threat                      | Enforced control                                                                                                                                          | Limit                                                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Indirect prompt injection   | Documents are passive bytes; fixed tasks, no model tools, literal source matching, closed schemas, manual application and authorization outside the model | Delimiters, regex warnings and schemas cannot guarantee semantic correctness. Hostile text can still appear in a proposed literal field. |
| Cross-workspace access      | Session membership checked per request, CAS writes and workspace locks; encrypted scopes/AAD; random opaque identifiers                                   | Deployment/session/OIDC misconfiguration can defeat application guarantees.                                                              |
| CSRF/session theft          | Exact origin and CSRF checks, PKCE/state/nonce, one-use state, HttpOnly cookies, Secure/__Host- in production, session revocation                         | HTTPS and a trustworthy OIDC provider remain prerequisites.                                                                              |
| Malicious PDF/image/archive | Separate bounded subprocess, format checks, size/page/pixel/decompression limits, no linked-asset fetching, hardened private container                    | Native parser vulnerabilities remain possible; container and dependency updates matter. Windows lacks Linux resource limits.             |
| Resource exhaustion         | Upload/queue/concurrency/admission limits, model and export caps, timeouts and rate limits                                                                | Per-instance limits are not a distributed quota service.                                                                                 |
| Data leakage                | AES-256-GCM, HKDF-derived scoped keys, private blobs, no request/document logging, CSP, no private service-worker caching                                 | Application memory, operator access and endpoints still see authorized plaintext. This is not end-to-end encryption.                     |
| Forged/replayed events      | Workspace-specific random webhook key, HMAC over timestamp/context/body, bounded clock window and durable replay receipt                                  | Signed input is an integration claim, not an established fact. Sender clock and canonical JSON must match.                               |
| Incomplete erasure          | Transactional derivative redaction plus durable object-deletion outbox and retry                                                                          | Backups, storage versions and external exports need operator-managed retention.                                                          |

The **owner** can manage members, public review moderation, integrations and
workspace export/deletion. Editors can edit trip content; viewers can read it.
No model can grant a role, send a message, change a reservation or determine a
claim's legal outcome.

## Optional model boundary

Disabled by default. An operator selects an HTTPS provider/model; a user previews
policy snippets and expressly consents per document. Only that displayed subset
is eligible for transmission. No credentials, system settings or other workspace
records are inserted in prompts. Users must redact any identifiers contained in
the selected source text before consent; the application does not claim perfect
PII detection or anonymization. Conservative screening excludes likely identifier, contact and URL snippets and known booking references before optional model selection. Injection, invisible-character and unresolved HTML-style warnings block that optional model path until review/sanitization.

At most six 600-character snippets, two attempts, 1,024 output tokens per request,
20-second requests and a 64 KiB response cap. A conservative UTF-8-byte-plus-output
reservation limits the path to 8,000 budget units; it is not a universal tokenizer
or a monetary billing guarantee. Usage reported by the provider is recorded
separately. No automatic retries of a persisted failed run and no open-ended loop.

LLM responses can propose only literal cancellation/baggage fields whose value
appears in the supplied source quote. Tool calls, extra properties and invented
text are rejected. Each accepted value must equal its entire displayed source
snippet, preventing a model from stripping a negation within that snippet.
Interrupted runs become `needs_review` without an automatic charged retry.
Proposals remain extracted and need the same manual application
as deterministic proposals. Schema validity is not truth or absence of injection.

## Operator obligations

Choose and document applicable processing purposes/bases, retention periods,
data-subject channels, children/third-party document handling and processors.
No blanket legal compliance claim is made. Minimize collected data; aliases and
functional needs generally suffice for planning. Booking references and source
documents remain private even though they may be useful to the traveler.

Use TLS to database/cache/object storage as appropriate, restrict IAM, block
public bucket ACLs, enforce egress allowlists, protect the application encryption
key, test recovery, and configure storage-version/backups expiry. Key rotation
and backup re-encryption currently require a tested operator migration; no
transparent automatic rotation is implemented.

The supplied private ingestion network has no public port or application/storage
credentials. Restrict model egress to the configured provider at infrastructure
level. Do not expose the worker directly to the Internet.

## Review and incidents

Automated regression tests and a read-only adversarial code review were used;
neither is a penetration-test certification. Recheck authorization/erasure after
changes to routes, jobs, storage or document application. Dependency lockfiles,
privacy checks, CI and SBOM generation support review, not proof of safety.

On incident: stop affected intake, revoke sessions/webhook credentials, preserve
access-controlled metadata needed to investigate, assess exposure and applicable
notification duties, patch, test, rotate affected secrets and document recovery.
Never publish affected travelers' evidence in issues or logs.

Method reference: [OWASP LLM Prompt Injection Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html).

## Calendar projection

Calendar exports default to a minimal projection without free-text titles, supplier names, codes, addresses or policy notes. Explicit `privacy=private` adds those fields. Even a minimal calendar reveals times and service kinds: share it deliberately. JSON/PDF/dossier exports remain private data.
