# Security evidence for the international ecosystem

The 0.4 ecosystem adds deterministic context, reconciliation, connector, document
planning and extension-draft runtimes. These campaigns extend the existing fuzz
suite. They do not replace its 13,000-case TypeScript campaign or document-ingest
campaign, SAST, DAST, dependency scanning, privacy scanning or human review.

## Run from a trusted checkout

Node 24 and the locked Python ingest environment must already be installed. From
the repository root:

```sh
node --import tsx security/fuzz/ecosystem.ts --seed 20261031 --cases 2000 --seconds 120 --output .local/security-audit/v0.4/fuzz/ecosystem.json
uv run --project ingest python security/fuzz/email_import.py --seed 20261031 --cases 384 --seconds 120 --output .local/security-audit/v0.4/fuzz/email-import.json
```

Both return zero only for `PASS`. Both anchor their inputs to their own checkout,
so the caller's working directory cannot select another project's sources. Report
paths must be JSON files under `.local/security-audit/`; do not substitute a
production data directory. There are no account credentials or API keys to supply.

The TypeScript campaign requires catalog format **3**. It runs five targets in
round-robin order: 400 cases per target at the default 2,000-case budget. Each
target has 16 recipe families; the seed varies proposed identifiers, language or
amounts within those families. Python has 24 MIME recipe families, each exercised
16 times at its default 384-case budget. Several bounded fixtures deliberately
repeat: a case count is not a count of unique attack classes. The MIME report also
records unique payload hashes.

Local execution on 2026-10-31, seed `20261031`, catalog format 3:

| Campaign             | Completed | Expected accepts/rejections | Findings / infrastructure failures | Result |
| -------------------- | --------- | --------------------------- | ---------------------------------- | ------ |
| TypeScript ecosystem | 2,000     | 600 / 1,400                 | 0 / 0                              | PASS   |
| Python email import  | 384       | 312 / 72                    | 0 / 0                              | PASS   |

The recorded supervisor durations were 2.85 s and 0.891 s respectively, within
their separate 120 s limits. Both recorded zero attempted network calls and stable
source fingerprints; the workspace's before/after snapshot digests match. These
are local results for the hashes in the JSON reports, not a remote CI result or a
guarantee about subsequent edits. Python recorded 234 unique payload hashes.

## Checked properties

| Target                 | Independent expected behavior                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global context         | Invalid shape, undeclared base currency, duplicate location, unknown route endpoint and conflicting geography reject; missing currency/purpose/locale/time zone remain unknown; DST gaps and folds do not become guessed instants; no implicit FX, totals or zero costs; output remains documentary.                                                                                                              |
| Booking reconciliation | Unknown amounts remain null, explicit zero survives, conflicting totals/status remain unresolved, equal numbers in different currencies do not agree, expired facts are excluded, malformed raw references and unsafe integers reject.                                                                                                                                                                            |
| Connector registry     | The entire request is authorized before any adapter read; wrong trip/record/source and exhausted budget perform no read; concurrent calls cannot overspend the shared budget; malformed/out-of-scope responses and remote errors are redacted; timeout never retries.                                                                                                                                             |
| Extension draft        | Traversal identifiers, collisions, reserved/duplicate fields, control characters and blank purpose reject; text resembling instructions remains a passive draft; requested capabilities grant no permission; returned paths/hashes remain valid; the loaded catalog is unchanged.                                                                                                                                 |
| Document workspace     | A disposable synthetic directory is inventoried; invalid identifiers, dates, references and modes reject; copy/move requests generate only a plan; proposed targets remain confined; source hashes and generated-content hashes match; complete path/content snapshots remain unchanged after every prepare and the whole campaign.                                                                               |
| Email normalization    | Explicit labels/HMAC preserve supported facts; conflicts remain unknown; invalid date/order and unsafe/unscoped amounts do not become usable facts; split-line labels are not joined; hidden/script text, attachments, nested messages, unsupported MIME and invalid charset do not become facts; byte/line/depth/part limits reject; raw content and synthetic reference/secret canaries never appear in output. |

Caller inputs are compared before/after the valid and semantic-invalid TypeScript
recipes; adapter response objects and Python byte inputs/metadata are also checked.
Malformed-shape recipes check exact controlled rejection rather than treating
arbitrary exceptions as successful validation. Unknown exceptions, unexpected
`AppError` codes/statuses, unexpected `ValueError` messages and violated properties
are findings. Worker startup/exit/deadline failure, incomplete campaigns and changed
source fingerprints are infrastructure failures and produce `FAIL`, not acceptance.

## Isolation and reports

Each supervisor launches a disposable worker with a hard wall deadline, at most
120 seconds. TypeScript denies HTTP(S)/fetch attempts; Python denies socket
connection and resolution attempts. Adapters are synthetic in-memory functions.
The workspace contains one synthetic text file in an OS temporary directory;
cleanup verifies its canonical parent before recursive removal. No `apply`,
rollback, account login, live provider, external model, OCR or attachment execution
is invoked. The campaign's own final report is the only intended persistent output.

Reports contain seed, requested/completed counts, target/recipe counters,
sanitized finding codes and case IDs, runtime versions, infrastructure status,
before/after source SHA-256 fingerprints and, for TypeScript, workspace snapshot
digests. They contain no payloads, raw references, secret keys, absolute checkout
paths, temporary paths, user documents, stderr or exception tracebacks. A finding
is reproduced locally with its seed/case ID; do not upload the underlying mail or
private source material to an issue.

For CI, run the two commands as separate jobs or steps and retain only these two
JSON reports as artifacts, including on failure. Keep command exit codes as merge
gates. Do not use `continue-on-error` to turn a finding or incomplete run green.
After changing any fingerprinted source, rerun the affected campaign; a prior
`PASS` applies only to its recorded fingerprints. Never assert results from a
previous commit apply to a newly modified runtime.

These are bounded, seeded mutation/property campaigns, not exhaustive,
coverage-guided or proof of immunity to prompt injection. They test deterministic
boundaries, not an actual model's resistance to adversarial instructions. Portable
OS memory caps and a native-code/network sandbox are absent. The connector timeout
cannot terminate an adapter that ignores abort; no such adapter runs here. Draft
free text is not automatically anonymized. Real OAuth scopes, vendor availability,
MCP host consent UI, authorized filesystem apply/rollback and live-provider
behavior require separate evidence.
