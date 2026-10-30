# Travel Reliability

**Open travel contracts, evidence and recovery workflows. Brazil first, usable worldwide.**

[Português](README.pt-BR.md) · [Quick start](#try-it-locally) · [Nine planning tools](docs/PLANNING.md) · [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Delivery evidence](docs/IMPLEMENTATION_STATUS.md)

Travel plans fail at the boundaries: an undisclosed fee, an unconfirmed booking, a missed connection, an inaccessible room, a refund with no trace. Travel Reliability makes those boundaries explicit, preserving what was offered, what was confirmed and what remains unknown.

This is a self-hosted v0.1 application and a public data contract. It does not sell tickets, invent inventory, file complaints or determine legal liability.

## Try it locally

Prerequisite: Node.js 24. No API key, database, Python or AI subscription is needed for the text-document demo.

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:5173** and choose **Explore demo**. The sample is fictional. Demo data is encrypted in memory and disappears on restart. Do not use the ephemeral demo as your only evidence archive.

For a single built server:

```sh
npm run build
npm start
```

Open **http://127.0.0.1:4310**. Production requires OIDC, PostgreSQL, Redis, private S3-compatible storage, HTTPS and an isolated ingestion worker; see [operations](docs/OPERATIONS.md).

## What works

| Workflow                  | Behavior                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trip Contract             | Flights, buses, lodging, rentals, activities, insurance and dependencies; JSON Schema 2020-12; time-zone and cost validation; optimistic versioning               |
| Pre-booking and departure | Transparent findings, information coverage, separate currency totals, connection buffers and uncovered nights                                                     |
| Evidence                  | Encrypted originals, SHA-256 manifests, source spans, manual field application, retention and deletion                                                            |
| Disruptions               | Manual events and workspace-scoped signed webhooks; dated Brazilian rule pack with applicability gaps                                                             |
| Dossiers                  | Factual chronology, refund ledger, JSON, PDF, calendar and passphrase-encrypted offline bundles                                                                   |
| Reviews and routes        | Evidence-linked private reviews, explicit moderation, versioned route data and source licenses                                                                    |
| Planning                  | Nine deterministic tools for dates, airports, connections, discounts, total costs, fare scenarios, negotiation drafts, hidden-city risks and household allocation |
| Access                    | OIDC/PKCE, private workspaces, owner/editor/viewer permissions, CSRF and secure production cookies                                                                |

The interface supports Portuguese and English. Other currencies, countries and IANA time zones are supported by the data model; legal coverage is limited to the checked Brazilian pack. Other country packs must be contributed and reviewed.

## Use without an LLM

Planning calculations, checklists, rules, exports and literal extraction run without an LLM. The optional LLM path requires operator configuration plus explicit per-document consent, previews selected source snippets, accepts only literal source-backed suggestions, limits repairs and caches results. It cannot invoke tools or apply a booking confirmation. See [cost and trust boundaries](docs/SECURITY_MODEL.md).

PDF/image/DOCX/HTML/EML extraction uses the isolated Python worker. Native OCR needs Tesseract with Portuguese and English language data. Extraction is never presented as supplier confirmation.

## Developer checks

```sh
npm run check
npm run build
npx playwright install chromium
npm run test:e2e
```

`npm run check` includes Python tests and therefore needs [uv](https://docs.astral.sh/uv/). All fixtures are synthetic. Real documents, credentials, family data and downloaded reference repositories are excluded from this repository.

## Public interfaces

- [Trip schema](schema/trip-contract.schema.json), [planning schemas](schema/planning.schema.json), [OpenAPI](api/openapi.json).
- [Prompt commands](prompts/README.md): portable, standalone workflows with no personal defaults.
- [Plugin contract](docs/PLUGINS.md): sources, permissions, provenance and country-rule lifecycle.
- [Reference comparison](docs/COMPARISON.md), [governance](GOVERNANCE.md), [contribution guide](CONTRIBUTING.md), [roadmap](docs/ROADMAP.md), [license](LICENSE).

Code, schemas, prompts and documentation: Apache-2.0. Explicit synthetic example data: CC0-1.0. Third-party and official source material retain their own terms. A hash proves byte consistency, not document authenticity; see the delivery record for tested coverage and remaining limits.
