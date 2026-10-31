# International documentary context

`prepareGlobalContext(input, trustedNow?)` builds a bounded, deterministic travel
context. Its public contract is [global-context.schema.json](../schema/global-context.schema.json),
with a complete [synthetic example](../examples/global-context.json). The function
does not select a home country, nationality, language, currency, visa entitlement
or legal regime for the traveler. Use `null` for unknown values where the schema
allows it; do not invent identifiers or mandatory structures to satisfy it.

## Inputs and results

- `language` is the chosen BCP 47 language tag; `locale` is a separate optional
  formatting preference. Both use the shared locale validator. The function
  returns stable machine-readable codes; it does not claim to translate every
  field or provide localized tourism content.
- Locations contain only pseudonymous IDs, declared alpha-2 country syntax,
  subdivision syntax, municipality keys and IANA time-zone identifiers. No names,
  addresses, passport or booking references are required. These codes are not
  geocoded or independently checked against an assigned-code registry.
- Each segment declares its mode, endpoints, civil departure/arrival and optional
  UTC offsets. Modes cover air, bus, rail, water, road, active transport, lodging,
  activities and professional commitments. The array order is the declared
  itinerary order, not an automatically optimized route.
- Scale is classified from supplied endpoints as `international`, `national`,
  `state`, `intermunicipal`, `local` or `unknown`. When finer geography is missing,
  only a coarser classification is returned; no missing municipality is invented.
  `state` means a shared first-level subdivision, not a jurisdiction-specific
  legal conclusion about which authority regulates the service.
- Civil time is resolved using the installed Temporal polyfill and runtime time
  zone data. A repeated DST time requires a matching offset. A nonexistent time
  stays unresolved instead of being moved to a different civil time. Missing
  zones, offset disagreements and arrival-before-departure remain visible.
- Adjacent moving segments produce a connection assessment. Its minimum is the
  one explicitly supplied for the arriving-to-next-departing transition; there
  is no universal airport/rail/ferry threshold. Matching location IDs and enough
  declared time do not verify carrier acceptance, terminal transfer or geography.
- Currency precision comes from the current runtime's `Intl` data. Amounts are
  not calculated or combined, and no FX conversion occurs. Mixed currencies
  require a dated exchange/rounding policy before later aggregation. Unknown
  costs are never converted into zero.
- Research topics create a targeted checklist for geography, history, culture,
  customs, safety, accessibility, entry, health, business and connectivity. The
  host must retrieve and evaluate the relevant sources; this tool does not
  invent local customs, historical facts, travel advice or opening hours.

## Evidence and country source plugins

Evidence consists of opaque `SRC` references, topic, geography/segment binding
and declared observation/expiry instants. Future observations, expired references
and unknown validity remain distinct. Even a current reference is returned as
`reference_supplied_not_verified`, never as independently authenticated evidence.

`jurisdictionSourcePlugins` is an immutable source-discovery registry for selected
official portals. `legalSourcePacket` reports `applicability_not_evaluated` and
zero executable legal rules. A country with no matching source plugin receives
an empty plugin list and an explicit verification action. Sources from another
country are not silently substituted. These portals were checked on 2026-10-31:

- [US Department of Transportation — Aviation Consumer Protection](https://www.transportation.gov/airconsumer).
- [UK Civil Aviation Authority — Air passengers](https://www.caa.co.uk/air-passengers/).
- [European Union — Your Europe travel](https://europa.eu/youreurope/citizens/travel/index_en.htm).
- [Canadian Transportation Agency — Air passenger protection overview](https://otc-cta.gc.ca/eng/air-passenger-protection-regulations-highlights).

Checking a portal does not establish the current legal rule, effective date,
territorial scope, exception, traveler eligibility or applicability to a booking.
Additional country/source plugins are reviewed application code; no document can
install a plugin or grant authority. Existing country-specific rules elsewhere in
the repository remain separately scoped and are not applied by this function.

## Runtime and security limits

The engine has no network, model, account, file, payment, calendar or persistence
access. `trustedNow` is a server/test argument, not an accepted input property.
It checks JSON descriptors before validation, rejects accessors, non-plain
objects, sparse arrays, prototype keys, unknown fields and oversized structures.
Inputs are limited to 64 locations, 64 segments and 128 evidence references;
serialized output is capped at 64 KiB. A valid but large input may be rejected
when its expanded report would exceed that output budget.

The runtime reports its ICU/time-zone versions. Operators must update runtime
data when needed before travel. This is a deterministic consistency/checklist
engine, not a geocoder, reservation confirmer, entry-permission service, legal
opinion or guarantee that a host LLM follows its instructions. Tests use only
synthetic data and explicit clocks; no personal account or real trip is queried.
