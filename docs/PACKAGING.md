# Distribution boundary and manual-kit contents

Distribution scripts anchor themselves to the physical core directory, not the
caller's current directory. `scripts/core-git.mjs` identifies the real Git top
level before a packager inspects status, HEAD, source blobs or artifact paths.
Both source and agent packagers require that top level to equal the core root.
An embedded copy such as `ecosystem/travel-reliability` therefore fails closed
with `CORE_GIT_STANDALONE_REQUIRED`, without an archive or output directory.
Boundary diagnostics contain a code, not a private path, Git error or stack.

This prevents the outer repository's HEAD/tree from being mistaken for the
public core. No subtree path argument, environment override or caller cwd is
used to reinterpret an ancestor as the distributable project. The helper clears
Git environment overrides and tracing for its subprocesses; no remote operation
is needed for these checks.

## Privacy checks in a host repository

`node scripts/privacy-check.mjs` scans tracked and unignored files only beneath
the physical core's Git prefix. It strips that prefix from findings, resolves
files against the core root and rejects links escaping it. A file outside the
core is neither read nor reported by this current-file mode. The scanner remains
heuristic; ignored material, unknown sensitive formats and the limits documented
in the security model still require manual review.

`--history` requires a standalone core checkout and refuses an embedding with
`CORE_GIT_HISTORY_REQUIRES_STANDALONE` before examining host files, commit
metadata or blobs. In the standalone checkout it continues scanning all refs,
commit metadata and unique blobs, with only the narrowly validated temporary
GitHub PR-merge metadata exception already supported. The checker does not turn
an embedding into permission to inspect or distribute the host history.

The application, portable instructions and MCP runtime do not require their own
Git checkout. Distribution and history auditing do. To publish a release, use a
clean, committed standalone checkout of the reviewed upstream core, then run:

```text
npm run agent:package
npm run release:pack
```

## Agent and skill packages

The manual kit and complete skill ZIP contain allowlisted Markdown instructions,
the eleven declared roles, 66 workflows, schemas, eighteen synthetic JSON input
examples and selected documentation. They preserve the nine planning calculator
IDs, license notices, historical license text and per-file/source digests. The
full source archive is a separate artifact.

The operator-profile schema and synthetic example, the operator setup guide and
the Unicode PDF guide are included. They document optional runtime configuration
without bundling an executor, credential or locally installed font. The verifier
requires these four files for packages from v0.4.0 onward.

The kit does not include Node/Python executors, dependency directories, private
instructions, raw emails or traveler records. Documentation links to included
files are remapped; links to runtime source or other nonincluded source files
point to the exact upstream commit. Relative links are verified rather than
silently dropped. The Python verifier checks CRC, path/type/size limits, exact
inventory, per-file hashes, catalog presence/counts/contracts, legacy calculator
IDs and all local Markdown file links. It rejects executable or unexpected file
paths even if an archive manifest lists them. These integrity checks do not
independently prove authorship, anonymization, legal accuracy or LLM behavior.

Tests use only temporary synthetic repositories. They exercise subtree refusal,
cwd-independent source packaging, exact ZIP membership, a foreign sentinel kept
outside the privacy scope and unchanged rejection of private current/history
content. They never package or inspect a real private repository for a test.

## Complete nine-asset release, v0.6 and later

The source packager is deliberately a source-only operation. The complete release
is assembled separately by [release-bundle.py](../scripts/release-bundle.py), using
Python 3.12 standard-library code and the existing agent-archive verifier. It
does not run archive contents, publish a release, create a tag, log into an
account or infer a successful independent review.

The exact published inventory is:

1. `travel-reliability-vVERSION.zip` — committed source.
2. `travel-reliability-agent-kit-vVERSION.zip` — manual instructions.
3. `travel-reliability-skill-vVERSION.zip` — complete skill.
4. `AGENT-SHA256SUMS` — the two instruction ZIPs.
5. `agent-release-manifest.json` — catalog and instruction-package metadata.
6. `sbom.cdx.json` — reviewed dependency inventory with the project identity.
7. `agent-audit-vVERSION.json` — sanitized evidence and eligibility record.
8. `release-manifest.json` — source identity and seven asset digests.
9. `SHA256SUMS` — all eight other assets, without a circular self-digest.

No private response, criterion text, eligibility document, local path or raw CI
log is copied into these assets. Only allowlisted metadata and SHA-256 values
are projected from the supplied evidence. The presence of hashes does not turn
an operator declaration into a signed attestation or prove model identity.

### Prepare the committed candidate

Use the final reviewed standalone checkout. Finish version/catalog/contracts,
commit the changes, and run the required checks. Source and instruction packagers
reject a dirty tree. For a stable publication, use the successful **push-event
CI runs of the final commit on main**, not a prior commit or only the PR preview.

```text
npm ci
uv sync --project ingest --locked
npm run agent:package
npm run sbom
npm run release:pack
```

Keep the generated SBOM unchanged as an explicit assembly input. Source and
instruction ZIP generation is deterministic for the same committed inputs and
toolchain. A freshly generated SBOM can legitimately change serial number or
generation time. Complete-bundle byte identity is promised only for the same
six base assets and the same frozen evidence inputs; the assembler does not
hide a changed dependency inventory by rewriting it to an old SBOM.

### Collect actual CI metadata

The optional `collect-ci` action reads only the two explicit Actions runs from
the project's GitHub API through an already authenticated `gh` installation.
It never reads authentication files or sends source/review contents. It checks
run ID, attempt, workflow path, final commit and main-branch identity before
writing an allowlisted record to a **new** output file. Missing jobs or a
different commit are errors; incomplete checks do not become PASS.

```text
uv run --project ingest python scripts/release-bundle.py collect-ci --verify-run VERIFY_RUN_ID --security-run SECURITY_RUN_ID --output .local/release-ci.json
```

`VERIFY_RUN_ID` and `SECURITY_RUN_ID` are the actual numeric IDs for this final
commit. The resulting format is `travel-reliability-release-evidence/1`, with
version, source commit/tree, a recorded UTC generation time and workflow/job
outcomes. The assembler can also accept this same record prepared offline from
reviewed API responses. Reusing a frozen CI record avoids changing a timestamp
when reproducing the exact same bundle.

### Bind the independent-review receipt

Keep the B.9 receipt and its objects in a private, local directory outside the
repository and outside synchronization. The receipt contains metadata only:

```json
{
  "format": "travel-reliability-b9-receipt/1",
  "version": "VERSION",
  "sourceCommit": "FINAL_40_HEX_COMMIT",
  "sourceTree": "FINAL_40_HEX_TREE",
  "baselineCommit": "REVIEW_BASELINE_40_HEX_COMMIT",
  "result": "APPROVE_WITH_CAVEATS",
  "generatorFamilies": ["openai"],
  "files": [{ "path": "api/src/planning.ts", "sha256": "FILE_64_HEX_SHA256" }],
  "deletedPaths": [],
  "packets": [
    {
      "id": "A1",
      "files": ["api/src/planning.ts"],
      "criteria": { "object": "criteria-A1.json", "sha256": "CRITERIA_64_HEX_SHA256" },
      "responses": [
        {
          "family": "google",
          "result": "APPROVE_WITH_CAVEATS",
          "object": "response-A1-google.txt",
          "sha256": "RESPONSE_64_HEX_SHA256",
          "eligibility": {
            "object": "eligibility-google.json",
            "sha256": "ELIGIBILITY_64_HEX_SHA256"
          }
        },
        {
          "family": "deepseek",
          "result": "APPROVE",
          "object": "response-A1-deepseek.txt",
          "sha256": "RESPONSE_64_HEX_SHA256",
          "eligibility": {
            "object": "eligibility-deepseek.json",
            "sha256": "ELIGIBILITY_64_HEX_SHA256"
          }
        }
      ]
    }
  ]
}
```

This is a schema example, **not evidence or a usable approval**. Replace every
placeholder with verified data. Register every generating family; do not infer
family from a product name or fill an unknown model version from a changelog.
Each packet needs at least two eligible families distinct from each other and
from all generators. Include every changed source path and explicitly record
deletions relative to an actual ancestor baseline. Additional dependencies can
be reviewed too. Each packet must cover its declared files; repeated response
bytes cannot count twice. Local evidence object names are opaque basenames, not
paths. Their actual bytes, criteria and eligibility records must match the
declared hashes. The program checks these bindings; it does not adjudicate the
meaning of a response or authenticate the eligibility conclusion.

### Assemble and verify before publication

The output directory must not exist. Assembly stages the nine files and checks
them before exposing the new directory. It refuses an embedded checkout,
uncommitted tree, wrong source ZIP, missing changed-file coverage, altered
response, reused response, same-family quorum, downgraded caveat, inconsistent
SBOM identity, missing checks or an unresolved stable-release gate.

```text
uv run --project ingest python scripts/release-bundle.py assemble --evidence .local/release-ci.json --review-receipt PRIVATE_RECEIPT_JSON --review-evidence-dir PRIVATE_OBJECT_DIRECTORY --output artifacts/release-vVERSION --require-stable
uv run --project ingest python scripts/release-bundle.py verify --directory artifacts/release-vVERSION --expected-version VERSION --expected-commit FINAL_COMMIT --source-tree-repository . --require-stable
```

The source ZIP must match **every** regular file/blob of the committed tree,
including files outside the reviewed delta. Supplying a matching source-manifest
hash cannot authorize replacement of an unreviewed source file. The agent ZIPs
retain the existing exact-membership, allowlist, link and source-commit checks.

For offline preparation without a completed B.9, omit the receipt and
`--require-stable`. The candidate report explicitly says `NOT_RUN` and
`stableEligible: false`; it cannot pass the stable gate. Do not upload private
objects to a workflow to turn that candidate into an approval.

Publication remains an explicitly authorized operator action after the gates.
Create a new immutable tag at the verified commit and upload **only** the nine
files from the assembled directory. Never replace a prior release's assets to
make a new result match its old hash.

### Verify the published download

Download all nine assets into an empty directory. Keep any API metadata JSON
outside that directory: unlisted files are rejected rather than silently
ignored. The optional metadata check requires the same stable tag and all nine
GitHub asset digests.

```text
gh release download vVERSION --repo RodrigoYuMatsumoto/travel-reliability --dir artifacts/download-vVERSION
gh api repos/RodrigoYuMatsumoto/travel-reliability/releases/tags/vVERSION > .local/published-release.json
uv run --project ingest python scripts/release-bundle.py verify --directory artifacts/download-vVERSION --expected-version VERSION --expected-commit FINAL_COMMIT --source-tree-repository . --require-stable --github-release-metadata .local/published-release.json
```

Use UTF-8 when creating the JSON on Windows. The verifier accepts UTF-8 with or
without BOM, rejects duplicate JSON keys and does not reflect raw exceptions or
local paths. Its checks do not execute any downloaded instructions. Perform the
separate documented installation/MCP smoke tests only in an isolated, synthetic
environment after inspecting the entrypoints.

Stable verification requires an explicit trusted standalone Git checkout and an
expected commit obtained from the reviewed tag/API, not from the downloaded
manifest alone. Every source ZIP byte is compared by SHA-256 against that Git
snapshot. Recomputing a malicious ZIP's manifests and checksums cannot satisfy
this independent source-tree binding. Without a checkout, non-stable integrity
verification is available and reports `sourceTreeBinding: NOT_RUN`. ZIP paths
also reject NUL normalization, Windows reserved/trailing-dot names, case aliases
and file/directory collisions before inspecting contents.

[The published-release workflow](../.github/workflows/release.yml) repeats these
download/integrity/eligibility checks for stable releases from v0.6 onward. It
has read-only repository permission and does not publish, merge, create tags,
run a model, or change the underlying review decision. Legacy v0.5 manifests
remain historical; the new verifier does not pretend to certify their old
schema retrospectively.
