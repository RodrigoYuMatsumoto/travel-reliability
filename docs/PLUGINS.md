# Plugin contract

v0.1 exposes explicit extension interfaces, not automatic discovery or remote
code loading. A plugin is reviewed application code deployed by the operator;
a document cannot install it or grant its permissions.

## Provider adapters

An adapter must declare provider, contract version, license, supported countries,
capabilities, credential scope, allowed hosts, rate limits, freshness and costs.
Return source URL/ID, observation timestamp, currency, group-level quote scope,
inclusions, expiry, availability state and gaps. Separate operator and seller.
Use official/permitted APIs; no robots bypass, unrestricted crawler, REPL, shell
or automatic booking. Store credentials outside evidence and prompts.

Inbound disruptions can use the workspace webhook integration. The owner obtains
a key via POST `/v1/workspace/integrations/webhook`; rotation replaces the key and
DELETE revokes it. Sign the lowercase hex HMAC-SHA256 of:

```text
timestamp.workspaceId.tripId.externalEventId.JSON.stringify(body)
```

Send `x-tr-timestamp` (Unix milliseconds), `x-tr-event-id` and `x-tr-signature`.
Timestamp must be within five minutes. The body must conform to the event schema;
canonical field order must match the serialized body used for signing. Receipts
prevent replay even after an event is removed. Never log or publish the key.

## Country packs

Declare country, version, official sources, verification/review dates, effective
intervals, territorial/service scope, fact prerequisites, exceptions and evidence
to collect. Add strict boundary, revocation, future-effective and uncertainty
tests. `needs_review` is required when applicable facts or freshness are missing.
Do not infer jurisdiction solely from the destination or universalize Brazilian
rules. Rule catalogs are information support, not automated legal opinions.

## Routes and reviews

Route contributions need provenance, source license and check timestamp per
claim. Unknown accessibility, safety and opening hours remain unknown. Do not
promise safe passage or use private location histories as public fixtures.

Reviews remain private until explicit owner moderation. A linked document means
`document_attached`, not identity verification or proof of a stay. Public output
does not include document IDs, booking references or private workspace content.
Automated authenticity scoring, listing-photo comparison and fraud detection
remain future work requiring separately evaluated models and moderation.
