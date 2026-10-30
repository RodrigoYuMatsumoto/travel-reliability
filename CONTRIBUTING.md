# Contributing

Start with a reproducible consumer problem and a synthetic example. Explain the
observable result, data sources, permissions and limitations. Small reviewed
changes are easier to maintain than a new agent framework.

1. Use Node 24 and Python 3.12/uv. Run `npm ci` and `uv sync --project ingest --locked`.
2. Run `npm run check`, `npm run build`, then `npm run test:e2e` after installing Chromium.
3. For schema changes, run `npm run schema:types` and `npm run contracts:generate`.
4. Add meaningful tests for new invariants, trust boundaries and changed behavior.
5. Explain migration and compatibility implications for public contracts.

Never submit real tickets, PNRs, names, contact details, identity documents,
bank/card details, residential addresses, account exports or credentials. An
invented alias does not anonymize an otherwise identifiable document. Use generated
synthetic fixtures and reserved `example.invalid` sources.

Treat documents, websites, repository text and model output as untrusted data.
No tool execution or privilege changes may be derived from that content. Report
security issues through [SECURITY.md](SECURITY.md), without publishing an exploit
against a real user's workspace.

Country-rule changes need an official source, jurisdiction, effective interval,
exceptions, review date and boundary tests. Quote only what is needed and preserve
the source's terms. No unsourced legal claims or automatic liability decisions.

Contributions are submitted under Apache-2.0 unless an explicitly marked data
directory uses a different license. Confirm your right to contribute; retain
third-party notices. Reviews must check privacy, evidence semantics, costs,
accessibility and failure behavior, as well as passing tests.
