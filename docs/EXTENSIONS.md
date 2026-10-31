# Create a reviewable travel-agent extension

`createExtensionDraft(input)` returns complete candidate files as strings. It
does not write files, load modules, install a role, change the catalog, grant
permissions or call a model. The strict generator contract is
[extension-draft.schema.json](../schema/extension-draft.schema.json); a synthetic
[museum-visit proposal](../examples/extension-draft.json) is provided.

## Proposal and output

Supply an ASCII hyphenated extension `id`, generic title and purpose, existing
catalog domains/capabilities, one to eight typed fields and one to eight
acceptance criteria. Fields support string, bounded integer, boolean, ISO date
and technical enum values. A hyphenated proposed field ID becomes a snake_case
JSON input key; the mapping is explicit in the result. Proposed capabilities are
a wishlist, not evidence of a configured tool or authority to act.

The result contains six full files under the fixed `drafts/<id>/` prefix:

| File                     | Content                                                                       |
| ------------------------ | ----------------------------------------------------------------------------- |
| `role.md`                | Candidate role with trust, tools, privacy, evidence, state and stop controls. |
| `prompt.md`              | Candidate task flow, inputs, execution boundaries and output contract.        |
| `input.schema.json`      | Strict candidate input schema with `tripKey` and typed fields.                |
| `intent.json`            | Passive proposed purpose, labels, criteria and field-name mapping.            |
| `catalog-candidate.json` | Proposed catalog entries and deterministic promotion paths, not applied.      |
| `test-plan.md`           | Required semantic, failure, hostile-data, privacy and regression scenarios.   |

Every file has a SHA-256 digest and the bundle has a deterministic digest. These
detect byte changes; they do not authenticate the proposer, approve an extension
or prove safety. The candidate uses its own ID as a compatibility alias. That
does not assert the existence of a historical agent with that name.

## Trust and promotion

Free proposed purpose, labels and criteria are kept in a JSON sidecar instead of
being interpolated as control instructions. Markdown headings are escaped;
JSON encodes fence/HTML-sensitive characters. Accessors, prototype keys, sparse
arrays, control/bidi characters, extra arguments, arbitrary module URLs/paths
and unknown capabilities are rejected. Known catalog ID, role-path and contract
collisions are checked without reading the filesystem. Device directory names
and reserved authority/path/credential field names are rejected.

1. Review the proposal and exclude personal data, booking references, financial
   records, secrets and private development material. Free text is **not**
   automatically anonymized; validation cannot identify every person's name.
2. Review and adopt an actual purpose and acceptance criteria. Proposed text,
   including a hostile sentence in `intent.json`, is not authority. Do not paste
   travel documents into a control-instruction file.
3. Refine field semantics and limits. Type validation alone does not establish
   the correct business range, source quality or completeness of an answer.
4. Save the reviewed candidates only to an operator-chosen safe destination.
   Check disk/path collisions and permissions separately; the generator has no
   filesystem inventory and cannot detect unregistered existing files.
5. Run the specified behavioral/regression tests with synthetic data and actual
   host interfaces. No test in the generated plan has been executed merely by
   generating it. Same-family review does not establish model-family independence.
6. Promote through a separate reviewed repository change. Configure actual host
   capabilities and action gates; recheck catalog compatibility and paths at
   promotion time. A newer catalog may introduce a collision after drafting.

No automatic promotion, executable plugin loader or arbitrary-code generator is
provided. Further executors are reviewed application code with their own tests
and permissions; a field or prompt cannot install one. The factory defaults to
`executor: null` and returns `draft_not_installed`.

## Limits and public-source boundary

The input is capped at 12 KiB and the serialized result at 32 KiB. Large valid
proposals may be rejected rather than truncated. Effects metadata describes the
generator invocation; loading the software itself uses the normal module loader.
Tests instrument relevant filesystem/network/process entrypoints, but are not
an operating-system sandbox or universal proof of a host LLM's behavior.

Public code and published prompts are inspectable and reusable under the project
license. Obfuscation cannot guarantee concealment of a development method.
Protect personal data, credentials, original private materials and operational
context by keeping them outside published files, packages, examples and logs.
