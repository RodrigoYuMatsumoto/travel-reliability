# Reproducible bounded mutation campaigns

Only generated synthetic bytes and the repository's declared synthetic fixtures are used. No input corpus from a traveler, network provider, user home or private folder is read. Reports and reduced recipes stay under the ignored `.local/security-audit/fuzz` directory.

Run from the repository root with its installed, locked dependencies:

```sh
uv run --project ingest python security/fuzz/ingest.py --seed 20261030 --cases 384 --seconds 120 --output .local/security-audit/fuzz/ingest.json
node --import tsx security/fuzz/typescript.ts --seed 20261030 --cases 9000 --seconds 120 --output .local/security-audit/fuzz/typescript.json
```

The scripts return 0 only when the requested campaign completes without findings or changes to target source fingerprints. Exit 1 indicates a finding; exit 2 indicates incomplete execution or changed target sources. Counts distinguish accepted input from intentional validation/parser rejection. A format rejection is not called a vulnerability.

## Python document frontier

Seeded structural/byte mutations cover UTF-8/text, hidden HTML, DOCX ZIP/XML, native PDF parsing/rendering, MIME nesting/parts, attachment subtrees and aggregate text bounds. Properties check unconfirmed extraction state and output/source limits. Whole batches of 16 cases run in disposable subprocesses with a twelve-second wall deadline. A bootstrap timeout before any case starts may be retried once and is reported separately; unresolved bootstrap failures are incomplete coverage, not parser findings. POSIX workers additionally request one GiB address space and seven CPU seconds. Windows reports that no OS memory limit was applied; input generation is bounded but is not a hard native-memory sandbox. DNS/socket connection/send operations are blocked in the target interpreter. Tesseract OCR is stubbed; native OCR accuracy is tested separately in the ordinary CI suite.

PDF mutations here are small structured samples, not an exhaustive hostile PDF corpus. Parser-level errors are classified by exception type without printing documents or tracebacks. Unexpected exceptions, assertion violations, recursion/memory errors, process exits and timeouts are findings for triage. Minimal generated recipes are retained on a finding. Reduced regressions for discovered MIME defects are in `ingest/tests/test_fuzz_regressions.py`.

## TypeScript boundaries

Seeded JSON mutations and arithmetic/source invariants cover money, household allocation, literal extraction, UTF-8 document parsing, trip schemas, nine planning tools, model-output validation, local times and deeply nested/prototype-key inputs. Each batch has a ten-second wall deadline and its own Node process with 256 MiB V8 old space. That is a JavaScript heap bound, not a whole-process/native-memory limit. Targets are pure validation/calculation functions; no model/provider calls are made and global fetch is blocked. Tool versions, seeds, completed cases, acceptance/rejection/finding counts, target coverage and source fingerprints are recorded.

These are deterministic mutation/property campaigns, not coverage-guided AFL/libFuzzer campaigns, a complete parser audit, a load test or a proof that prompt injection is impossible.
