# Adoption and delivery roadmap

Stars are an external outcome, not a deliverable or a guaranteed growth metric.
The engineering priority is a useful, portable workflow people can verify.

Version 0.2 makes the portable agent the primary entry point: manual instructions with no installation, a self-contained skill, and optional local MCP tools under the user's own LLM. Measure correct workflow selection, separation of trips, unknown-value preservation, evidence freshness, tokens per useful decision and explicit authorization for external commitments. The browser app remains optional support, not a prerequisite for using the agent.

| Stage                           | Exit evidence                                                                                                              | Measure                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 0.1 — Evidence before departure | Reproducible synthetic demo, contracts, offline bundle, nine documentary tools, regressions and documented limits          | Completion rate, unknown critical fields, export/decryption success, extraction correctness, zero default model calls |
| 0.2 — Pilot reliability         | Opt-in traveler pilots, accessible guided forms, measured OCR/provider quality, privacy review, restore/deletion exercises | Time to complete a trip pack, correction rate, false confirmations, p95 latency, cost per document                    |
| 0.3 — Provider ecosystem        | Licensed adapters and independently reviewed country packs, conformance suite, migration support                           | Adapter freshness/coverage, broken source rate, country-pack review latency                                           |
| 1.0 — Operational maturity      | External security assessment, fleet-wide admission, key rotation/migrations, recovery drills, compatibility policy         | Isolation/erasure failures, incident resolution, restore objectives, sustainable maintenance                          |

## Open-source growth

Publish a two-minute synthetic demonstration and a one-command local setup;
lead the README with a concrete missed-connection/evidence problem. Maintain
bilingual documentation, small labeled starter tasks and reproducible bug
templates. Package schema/validation/CLI separately only after their contracts
stabilize. Offer useful exports without an AI subscription or hosted lock-in.

Seek feedback from travelers, accessibility users, consumer organizations,
operators and developers without publishing their evidence. Track repeat use,
resolved problems and external contributions before vanity metrics. No bought
stars, engagement automation, fabricated testimonials or unsolicited outreach.

## Explicitly deferred

Automatic flight-status polling, real-time fare search, CNPJ/Cadastur lookups,
live promotion validation, booking/payment, automatic complaint submission,
identity/stay verification, visual listing-truth detection, native mobile apps,
automated FX and independent country packs. Their absence is visible rather
than simulated. The current deterministic risk indicator is a transparent
heuristic, not a calibrated probability or supplier reputation score.
