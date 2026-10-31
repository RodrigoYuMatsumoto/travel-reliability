# Travel Reliability

**Make your own AI a travel agent with traceable sources, explicit costs and verifiable evidence. Brazil first, usable worldwide.**

[Português](README.pt-BR.md) · [Use your AI](#use-your-ai-no-installation) · [Command catalog](prompts/README.md) · [Agent audit](docs/AGENT_AUDIT.md) · [Optional local app](#optional-local-app) · [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Delivery evidence](docs/IMPLEMENTATION_STATUS.md)

Travel Reliability starts with a **portable agent instruction kit** you give to your own LLM. The 0.3 catalog routes eight roles and 52 commands across transport, lodging, itineraries, insurance, health logistics, evidence and group costs. These are instruction workflows, not eight running services; the catalog follows audited needs rather than a quota. Optional validated local tools handle calculations and contracts; a self-hosted app supports private evidence organization.

The agent distinguishes quoted facts, verified conditions and unknowns. It does not acquire browsing or provider access merely by reading a prompt, and the documentary tools never invent inventory or submit a transaction. Purchases, cancellations and messages require specific traveler authorization and a real authorized execution capability.

## Use your AI: no installation

1. Open [the agent instructions](agents/TRAVEL_AGENT.md), click **Raw**, and copy the content into your AI host's project instructions or a new conversation.
2. Select one relevant role and [command](prompts/README.md). Do not attach the full catalog to each turn; the hub routes the next step.
3. Describe the trip with pseudonyms and the minimum necessary constraints. Tell the host which capabilities it actually has, such as authorized browsing or local tools.

```text
Use Travel Reliability and the group-split workflow to plan a fictional trip.
Work with households N01 and N02, five nights and currency BRL.
First identify the constraints needed to compare complete group costs.
Do not invent prices, availability or accepted allocation rules.
```

Markdown instructions require no Node.js, npm, Git, Docker or local web server. The LLM runs in the host you choose under its own permissions and data policy. [Agent setup, the optional skill ZIP and MCP connection](agents/README.md) explain the boundaries. The public [agent-kit manifest](agents/manifest.json) is a package index, not a universal plugin installer. A compatible skills host can use the packaged `travel-agent` folder; other interfaces use explicit copy/paste.

For executable local tools in a compatible stdio MCP host, install the full repository's Node.js dependencies and configure the host to run `node` with the absolute path to `scripts/agent-mcp.mjs`. This is optional; it is not a live fare-search connector or automatic compatibility with every chat interface.

## Optional local app

For the evidence app on Windows, install **Node.js 24**, choose **Code → Download ZIP** on GitHub, extract the full source ZIP, and double-click **`start-demo.cmd`**. The first start installs locked dependencies; later starts reuse a matching installation. The browser opens only after the synthetic demo is ready. Git, Python, Docker and a model API key are not required for this text-document demo. Keep its window open while using the app.

For developers using an existing terminal:

```sh
git clone https://github.com/RodrigoYuMatsumoto/travel-reliability.git
cd travel-reliability
npm ci
npm run demo
```

Open **http://127.0.0.1:5173** and choose **Explore demo**. The sample is fictional. Demo data is encrypted in memory and disappears on restart. Do not use the ephemeral demo as your only evidence archive.

`Missing script` means npm is reading a different project's package.json. `ERR_CONNECTION_REFUSED` means the local server is not accepting connections. During the demo, port 5173 serves the interface and port 4310 serves the API (`/health`); these are addresses on the computer running the launcher, not hosted GitHub websites. See [installation and diagnostics](docs/INSTALLATION.md).

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
| Workflow catalog          | Domain/phase discovery and workflow preparation with explicit gaps, source references and data checkpoints; no external execution                                 |
| Incurred expenses         | Separate deterministic reconciliation of payers, beneficiaries, previous settlements and integer balances; suggestions never transfer money                       |
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
- [Agent and command catalog](docs/AGENT_CATALOG.md): eight roles, 52 commands, nine original calculators and a separate expense-settlement calculator. Forty-three entries have no legacy calculator; workflow preparation does not execute research or booking.
- [Source coverage](agents/coverage.json) and [agent audit](docs/AGENT_AUDIT.md): sanitized provenance, preserved behavior, corrections and validation limits.
- [Prompt commands](prompts/README.md): load one task, not every file. The original calculator IDs and legacy MCP agent resource remain available.
- [Plugin contract](docs/PLUGINS.md): sources, permissions, provenance and country-rule lifecycle.
- [Reference comparison](docs/COMPARISON.md), [governance](GOVERNANCE.md), [contribution guide](CONTRIBUTING.md), [roadmap](docs/ROADMAP.md), [license](LICENSE).

Code, schemas, prompts and documentation: Apache-2.0. Explicit synthetic example data: CC0-1.0. Third-party and official source material retain their own terms. A hash proves byte consistency, not document authenticity; see the delivery record for tested coverage and remaining limits.
