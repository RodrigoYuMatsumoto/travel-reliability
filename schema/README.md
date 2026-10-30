# Public contracts

`trip-contract.schema.json` is the authoritative TripContract contract (JSON Schema 2020-12).
Run `npm run schema:types` to generate TypeScript. CI checks that generated output is current.

Contracts distinguish a quote from a booking and information from confirmation. Null means unknown;
it never means free, safe, confirmed or not applicable. Identifiers are opaque strings, not numbers.
Provider registration requirements belong to a dated country rule and a provider category.

Only bundled, reviewed schemas may be compiled. Remote references and user-supplied schemas are prohibited.
