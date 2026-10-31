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
