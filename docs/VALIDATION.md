# Reproducible usefulness and cost evidence

Run the deterministic documentary benchmark after installing the locked graph:

```text
npm run benchmark
```

It executes the twelve planning calculators on committed synthetic examples, rejects a
missing-input case for each, prepares the matching workflow under a one-call
budget, and records local p50/p95 latency. Each normal calculator is executed 25
times. The benchmark calls no model, provider, mailbox or private storage.

The report compares UTF-8 bytes of the full prompt catalog with the selected
prompt and preparation. **Bytes are a labeled payload proxy, not tokens.** It
does not claim a token reduction percentage, paid-inference cost, model accuracy
or traveler adoption. Exact token measurement requires an identified tokenizer
and comparable host prompts. Do not infer savings from character counts.

The on-demand contract is concrete: load the hub once, then one role/workflow;
run arithmetic and schema validation deterministically; preserve unknowns and
use a bounded checkpoint. The benchmark confirms that execution path, rather
than asking a model to repeat the arithmetic as a quality test.

## Opt-in human pilot protocol

Human adoption is external evidence and is not fabricated by synthetic runs.
For a consented pilot, keep all traveler evidence local and record only aggregate
outcomes: pack completion time, correction count, missing critical fields,
false confirmations, successful offline decryption, latency and host-token usage
when actually available. Do not collect names, documents, localizers or payment
details for a public benchmark. Compare the same task and acceptance criteria
before/after; a lower payload does not excuse a wrong recommendation.

The initial acceptance set is executable without a real journey: airports with
missing terrestrial cost, conditional bus assistance, unknown fares, future/stale
sources, household cash exposure, source conflicts, hostile document text,
unapproved connector/workspace reads, offline exports and derivative erasure.
CI and focused regressions cover their coded invariants; they do not replace
independent review or a measured human pilot.

## Regional package observation mutation campaign

`uv run --project ingest python security/fuzz/regional_packages.py --seed 20261104 --cases 400 --seconds 90`
exercises the adopted `travel_ingest.packages.parse_package` implementation and
its `package-observation/1` contract. No second regional extractor is installed.
Four existing synthetic detail fixtures supply the parser layouts; seeded
mutations alter principal amounts, optional prices, hidden/script text, years,
breakfast variants, formats, source metadata and actual return dates.

The campaign verifies caller/source/hash binding, evidence quotes against the
input corpus, contract validity, absence of injected/private text, and preservation
of unknown or non-authoritative states. An inferred date must not acquire
`yearStated: true`. An Augustus static shell must not become a rendered offer.
Space-grouped amounts are tested according to the adopted parser's supported
grammar; malformed amounts cannot become a partial price. Optional prices and
installments must not replace the principal price.

The supervising process imposes a wall deadline and accepts only bounded
metadata with complete counters. The report contains seed, counts, safe failure
codes, campaign digest and fingerprints of parser sources and fixtures. It never
contains HTML, prices, contacts or observations. Python socket entry points are
denied during the campaign; this is not an OS sandbox. No real source, account,
LLM or browser is contacted. Offline URL validation is not supplier authentication
or the online fetcher's host policy. Native parser years, retrieval flags and
source limitations still govern the Node calculator.

Six harness controls cover determinism, false verification, unexpected output,
incomplete/extended reports, malformed metadata and process timeout. When locked
ingest dependencies are unavailable, their standard-library discovery reports a
skip; the dedicated CI fuzz stage runs them through the ingest interpreter before
the 400-case campaign. UI browser tests, fetch integration, container isolation,
and independent B.9 review remain separate evidence.
