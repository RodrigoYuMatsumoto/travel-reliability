# Travel Reliability

**An international travel agency ecosystem for BYOM (Bring Your Own Model): multimodal journeys, explicit costs, traceable sources and private evidence.**

[Português](README.pt-BR.md) · [Use your AI](#use-your-ai-no-installation) · [Command catalog](prompts/README.md) · [Agent audit](docs/AGENT_AUDIT.md) · [Optional local app](#optional-local-app) · [Security](SECURITY.md) · [Architecture](docs/ARCHITECTURE.md) · [Delivery evidence](docs/IMPLEMENTATION_STATUS.md)

Travel Reliability starts with a **portable instruction kit for the LLM you choose**. The 0.6 release-candidate catalog routes eleven roles and 69 workflows across international, domestic, regional and local leisure or professional travel. It covers transport, lodging, geography, history, culture, local customs, business preparation, insurance, health logistics, documents and group costs. Roles are selected instructions, not background services. Deterministic tools handle contracts, context and reconciliation; an operator-bound workspace can organize actual local files through reviewed plans and explicit CLI authorization.

Version 0.6 is a release candidate, not yet published. It adds a [verified Codex installer/updater](docs/INSTALLATION.md#4-codex-complete-skill-nine-shortcuts-and-offline-mcp), [opt-in public sources and practical integration alternatives](docs/PUBLIC_SOURCES.md), a [reproducible synthetic benchmark](docs/VALIDATION.md), and [complete nine-asset release verification](docs/PACKAGING.md#complete-nine-asset-release-v06-and-later). The default MCP remains offline with explicit permissions.

The agent distinguishes quoted facts, verified conditions and unknowns. It does not acquire browsing or provider access merely by reading a prompt, and the documentary tools never invent inventory or submit a transaction. Purchases, cancellations and messages require specific traveler authorization and a real authorized execution capability.

There is no default country or provider. Country-specific rules remain scoped plugins, and an unsupported jurisdiction stays unverified. [International context](docs/GLOBAL_CONTEXT.md), [account/email connectors](docs/CONNECTORS.md), [document operations](docs/DOCUMENT_WORKSPACE.md) and [extension drafts](docs/EXTENSIONS.md) describe executable capabilities and operator prerequisites. No particular LLM vendor is required.

## Architecture and workflows

The operational interface can be ordinary text, or voice when supported by the chosen host. The host maps the request to one selected workflow; the traveler need not write JSON or load the entire catalog. The same structured record supports review of costs, source coverage, versions and evidence exports. [BYOM usage and audit boundaries](docs/BYOM.md) distinguish supported capabilities from deployment goals.

- **Operational edge:** natural-language intake, progressive instructions and explicit unknowns; no model or browser capability is assumed.
- **Audit layer:** integer financial reconciliation, versioned records and hash manifests help detect changes. They do not make storage immutable or certify legal compliance.
- **Deterministic execution:** code checks supported inputs and calculations. An unsupported price, eligibility condition or supplier assertion remains unverified.
- **Operator-bound workspace:** reviewed plans and explicit CLI authorization govern file changes. Document text cannot authorize actions.
- **Scoped localization:** country rules are plugins; legal coverage and effective dates must be checked separately.

## Find local packages and compare complete costs

The optional [agency discovery](docs/PACKAGE_DISCOVERY.md) flow accepts an origin, independent date windows and an optional destination. Its initial regional catalog contains the supplied Atrativa, Niel, Viajantes do Valle and Augustus references. Social profiles and dynamic pages are research leads, not current quotes or supplier endorsements. The default MCP discovery is offline; the separate CLI reader requires explicit network approval and accepts fixed source IDs only.

Use `ground-transport` to compare **agency package, bus + hotel and flight + hotel**, including hotel breakfast or explicitly priced outside breakfasts. Account for both transport legs, baggage, seats, airport transfers, hotel nights, taxes and mandatory extras. [The comparison contract](docs/GROUND_TRANSPORT.md) keeps incomplete costs and non-equivalent savings unresolved.

## Use your AI: no installation

1. Open [the agent instructions](agents/TRAVEL_AGENT.md), click **Raw**, and copy the content into your AI host's project instructions or a new conversation.
2. Select one relevant role and [command](prompts/README.md). Do not attach the full catalog to each turn; the hub routes the next step.
3. Describe the trip with pseudonyms and the minimum necessary constraints. Tell the host which capabilities it actually has, such as authorized browsing or local tools.

```text
Use Travel Reliability and the group-split workflow to plan a fictional trip.
Work with households N01 and N02, five nights and currency USD.
First identify the constraints needed to compare complete group costs.
Do not invent prices, availability or accepted allocation rules.
```

Markdown instructions require no Node.js, npm, Git, Docker or local web server. The LLM runs in the host you choose under its own permissions and data policy. [Agent setup, the optional skill ZIP and MCP connection](agents/README.md) explain the boundaries. The public [agent-kit manifest](agents/manifest.json) is a package index, not a universal plugin installer. A compatible skills host can use the packaged `travel-agent` folder; other interfaces use explicit copy/paste.

For executable local tools in a compatible stdio MCP host, install the full repository's Node.js dependencies and configure the host to run `node` with the absolute path to `scripts/agent-mcp.mjs`. This is optional; it is not a live fare-search connector or automatic compatibility with every chat interface. The [operator profile](docs/OPERATOR_PROFILE.md) separately enables a bounded document workspace and explicitly selected Gmail reads.

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

## Capability matrix

Availability says where each capability runs; evidence names the automated tests that cover it. Audit status and open findings: [README conformance audit](docs/audits/2026-11-04-conformidade-readme.md).

| Capability                     | Behavior                                                                                                                                                                                                                                                                                                                                                                                             | Availability                                                                                                                                                                                                                          | Evidence                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Trip Contract                  | Flights, buses, lodging, rentals, activities, insurance and dependencies; JSON Schema 2020-12; strict IANA time zones, ISO 4217 minor units and integer cost validation; bundled-tour tags with stored package comparisons; optimistic versioning                                                                                                                                                    | API, app, MCP `travel_check_trip`                                                                                                                                                                                                     | `tests/core.test.ts`, `tests/phase1-validation.test.ts`, `tests/bundled-tour-contract.test.ts`          |
| Pre-booking and departure      | Transparent findings, information coverage, separate currency totals, connection buffers and uncovered nights                                                                                                                                                                                                                                                                                        | API, app, MCP                                                                                                                                                                                                                         | `tests/core.test.ts`                                                                                    |
| Evidence                       | Encrypted originals with a separate blob key scope, SHA-256 manifests, source spans, manual field application, retention and deletion                                                                                                                                                                                                                                                                | API and app; durable stores in production                                                                                                                                                                                             | `tests/security.test.ts`, `tests/phase1-ingestion.test.ts`                                              |
| Disruptions                    | Manual events and workspace-scoped signed webhooks; dated Brazilian rule pack with applicability gaps and review when the effective date is ambiguous across Brazilian time zones                                                                                                                                                                                                                    | API and app                                                                                                                                                                                                                           | `tests/rules.test.ts`, `tests/phase1-rules-auth.test.ts`                                                |
| Dossiers                       | Factual chronology, refund ledger, JSON, PDF, calendar and passphrase-encrypted offline bundles (`TRB2`, scrypt N=2^17, manifest matched one-to-one with files)                                                                                                                                                                                                                                      | API and app                                                                                                                                                                                                                           | `tests/core.test.ts`, `tests/phase1-bundle-crypto.test.ts`                                              |
| Reviews and routes             | Evidence-linked private reviews, explicit moderation, versioned route data and source licenses                                                                                                                                                                                                                                                                                                       | API and app                                                                                                                                                                                                                           | `tests/security.test.ts` (partial)                                                                      |
| Planning                       | Thirteen deterministic calculators: the nine original tools plus ground transport, loyalty, multimodal stitching and regional package arbitrage; integer arithmetic, no model or network calls                                                                                                                                                                                                       | API, app, CLI `npm run plan`, MCP `travel_plan`                                                                                                                                                                                       | `tests/planning.test.ts`, `tests/planning-regressions.test.ts`, `tests/intelligence.test.ts`            |
| **Regional Package Arbitrage** | Extracts literal destination, dates, bus or air, lodging, breakfast and published price from regional agency package pages (Atrativa Tur, Niel Turismo, Viajantes do Valle, Augustus Turismo) and compares the agency total with bus and/or air plus lodging with and without breakfast, showing the agency premium or discount per scenario; unknown values stay null and prices are never invented | Python offline extractor, MCP `travel_extract_package`, calculator `package-arbitrage`; bounded static capture requires `--allow-network`; automatic external browser rendering is unavailable, assisted DOM remains unverified input | `ingest/tests/test_packages_*.py`, `tests/package-arbitrage.test.ts`, `tests/package-extractor.test.ts` |
| Workflow catalog               | Domain/phase discovery and workflow preparation with explicit gaps, source references and data checkpoints; no external execution                                                                                                                                                                                                                                                                    | Portable kit, MCP `travel_catalog` and `travel_workflow`                                                                                                                                                                              | `tests/agent-catalog.test.ts`, `tests/agent-workflow.test.ts`                                           |
| Incurred expenses              | Separate deterministic reconciliation of payers, beneficiaries, previous settlements and integer balances; suggestions never transfer money                                                                                                                                                                                                                                                          | MCP `travel_settle_expenses`                                                                                                                                                                                                          | `tests/agent-expenses.test.ts`                                                                          |
| Access                         | OIDC/PKCE, private workspaces, owner/editor/viewer permissions, CSRF and secure production cookies, including secure cookie removal                                                                                                                                                                                                                                                                  | Production API                                                                                                                                                                                                                        | `tests/oidc.test.ts`, `tests/phase1-rules-auth.test.ts`                                                 |

See [regional package arbitrage](docs/PACKAGE_ARBITRAGE.md) for supported pages, the offline and opt-in network paths and how to read premium, discount and equivalence.

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
- [Agent and command catalog](docs/AGENT_CATALOG.md): eleven roles, 69 commands, thirteen planning calculators (including the nine original IDs) and a separate expense-settlement calculator. Workflow preparation does not execute research or booking; additional runtime capabilities require the documented operator configuration.
- [PDF font configuration](docs/UNICODE_EXPORTS.md): verified local font coverage, explicit missing-glyph errors and limits of complex-script rendering.
- [Source coverage](agents/coverage.json) and [agent audit](docs/AGENT_AUDIT.md): sanitized provenance, preserved behavior, corrections and validation limits.
- [Prompt commands](prompts/README.md): load one task, not every file. The original calculator IDs and legacy MCP agent resource remain available.
- [Plugin contract](docs/PLUGINS.md): sources, permissions, provenance and country-rule lifecycle.
- [Reference comparison](docs/COMPARISON.md), [governance](GOVERNANCE.md), [contribution guide](CONTRIBUTING.md), [roadmap](docs/ROADMAP.md), [license](LICENSE).

Original code, schemas, prompts and documentation from v0.4.0: MIT, with the original repository identified in the attribution notices. Earlier releases retain their published Apache-2.0 terms. Explicit synthetic examples: CC0-1.0. Third-party and official materials retain their own terms. See [licensing](docs/LICENSING.md), [publication boundaries](docs/PUBLICATION_BOUNDARY.md) and the delivery record. Hashes prove byte consistency, not authenticity or universal security.

See [deterministic intelligence contracts](docs/INTELLIGENCE.md) for bounded loyalty and multimodal calculations, hierarchical country packs, cryptographic claim binding and explicit unverified states. The nine original prompt aliases remain available.
