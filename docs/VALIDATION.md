# Reproducible usefulness and cost evidence

Run the deterministic documentary benchmark after installing the locked graph:

```text
npm run benchmark
```

It executes the eleven planning calculators on committed synthetic examples, rejects a
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
