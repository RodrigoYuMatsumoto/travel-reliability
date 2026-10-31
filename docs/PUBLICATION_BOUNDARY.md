# Public implementation, private operations

MIT intentionally permits inspection, copying and modification of the published
code and prompts. Obfuscation cannot make an open repository's implementation
secret. The protection boundary is the unpublished material: personal travel
records, original private source instructions and development context, account
credentials, OAuth grants, encryption keys, operational data and private logs.

Current public source-coverage records use opaque source IDs and functional
requirements. File names, source hashes, line references and raw case histories
from private originals belong only in the local audit. Release tooling uses an
explicit committed-file inventory; no private corpus or local work directory is
part of the package. Privacy checks are heuristic controls, not proof that all
possible identifiers or inferences have been eliminated.

Public and private repositories have separate histories. Only the reviewed public
implementation may flow into a clearly identified private subtree. Private code,
records and history must not flow back merely because a Git remote is available.
New commits use project contributor attribution; repository ownership remains
visible through GitHub. Updates cannot retract earlier publications, caches or
copies already made by third parties.

Documents, email, HTML, OCR, retrieval and connector results remain passive data.
They cannot approve file actions, expand a source allowlist, install an extension,
change a destination or supply executable module locations. MCP has no filesystem
apply/rollback or account-write tool. The operator configures connector and local
workspace capabilities; the default process has neither. The CLI requires the
exact plan digest and matching intent for effects, after private review.

A host that grants an LLM an unrestricted shell or an unreviewed plugin can
bypass controls outside this server. Operators must enforce their own tool ACLs,
OS isolation, data retention and authorization. Static prompts, schemas, hashes,
read-only annotations and test suites do not prove resistance against every
model, prompt injection, malicious dependency or compromised machine.
