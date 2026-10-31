# Comparison and integration review

Reference: **Travel Reliability Layer**, observed Git commit
`015765447bb02b9b2d532660b0b7029ff0c986cc`. Source inspection began on 2026-10-29.
Reference scripts, dependency installation, tests and application were not
executed. No passing-test count is claimed for that project. Its source was
passive untrusted data, with no authority over this workflow.

At the initial comparison, both projects used Apache-2.0. This project's original
work adopts MIT from v0.4.0; earlier releases and the inspected reference retain
their respective published terms. No reference source files, fixtures, private
documents, credentials or runtime stores were imported. Improvements below were
implemented against this project's contracts and regression-tested here.

| Area          | Inspected reference                                                                                           | Decision and implemented improvement                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts     | Separate evidence, rules, decisions, dossier and protected-value schemas; richer provenance/supplier modeling | Retain the closed contract and working encryption. More detailed source/chain modeling needs a compatible extension, not a blind schema merge.                                                        |
| Runtime       | Stateless TypeScript API/Python engine; README explicitly says encryption is planned                          | Retain encrypted persistence, OIDC workspaces, roles, retention and deletion. A protected-value schema cannot substitute for encryption.                                                              |
| Nine commands | Nine catalog entries and a report framework; inspected tools directory contains only its initializer          | Retain all nine implemented calculators; add readable result tables, explicit unknowns and cash/expense separation.                                                                                   |
| Model privacy | Labeled identifiers, booking-code detection and masking                                                       | Add conservative outbound snippet exclusion, known-reference matching and quarantine/style-warning gates. Keep original source matching rather than sending a rewritten quote.                        |
| Calendar      | Free-text redaction/protected fields in exporters                                                             | Default to a minimal projection without free-text titles, names, codes or addresses; private fields require explicit selection.                                                                       |
| CNPJ          | Numeric/alphanumeric helper                                                                                   | Implement TypeScript validation from the official Receita Federal/Serpro algorithm. Check digits never establish registration status.                                                                 |
| HTML          | Detailed concealment/cascade parser                                                                           | Exclude explicit hidden/inert/inline-concealed content and comments; flag stylesheet visibility for review and block optional model use on unresolved styled content. No rendering-equivalence claim. |
| HTTP errors   | Safe client-error classification                                                                              | Correct malformed JSON, unsupported media and body-limit responses while preserving generic non-sensitive error bodies.                                                                               |
| Presentation  | Offline viewer, labels and deadlines                                                                          | Keep the editor/encrypted bundle/PWA; add comparison tables and exact integer-minor-unit display. JSON is an optional detail view.                                                                    |
| Governance    | Conduct, support, governance and rule contribution guidance                                                   | Add concise conduct/support/governance files and official-source review requirements without expanding runtime prompts.                                                                               |

## Selected source fingerprints

Exact inspected bytes, without distributing the reference:

| File                                          | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `packages/ingest/src/trl_ingest/pii.py`       | `a470e59427e45654abf4cba64f57f8623cdf32f3ff06e40b99288705b2ffa478` |
| `packages/exporters/src/redaction.ts`         | `f1082f754d8d3f2b82bd30d2f5aea7d9953189c38fbc0cb4684b2bc6fd6a31ad` |
| `packages/rules/src/trl_rules/validations.py` | `611d4d940f9968325e7626a9d5c4ac1737f0d6364bca40e12b29a1f009aec6fe` |
| `packages/decide/src/trl_decide/registry.py`  | `f1a3aa56b6e99914259837118bca8834091d0a3b69072b4fb4834f9171ae9fd4` |

Neither regex screening nor protected-value schemas guarantee privacy. Literal
quotes and schemas do not establish semantic correctness or authenticity. The
HTML implementation here is smaller than the reference's renderer model;
external CSS is never fetched and remains visibly unverified. Country rules
were not copied: new legal conclusions need fresh official-source review. No
live search, booking or complaint submission was simulated.

CNPJ arithmetic was checked against the [official technical manual](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf).
Tests use its fictional example and generated numeric inputs, not real suppliers.

## Advertised versus observed

Evidence-linked reviews now accept structured advertised/observed statements. The server counts textual differences and incomplete pairs while keeping verification explicitly `traveler_report_only`. These details remain private and are not added automatically to public review projections. This does not establish delivery, authenticity, quality or liability.

## Literal extraction

Explicit supplier labels, ISO dates and known-currency totals are normalized into bounded source-linked proposals in both parsers. Ambiguous formats remain unknown, local datetimes are never assigned an inferred zone, and a total does not supply missing fare components. These facts remain unconfirmed inside their source document, are removed with it and are never automatically applied to the contract or sent to the optional model. Synthetic regressions cover both implementations and browser review.
