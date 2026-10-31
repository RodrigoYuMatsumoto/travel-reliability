# Email, provider accounts and passive evidence

The connector registry in `agent/connectors.ts` executes reviewed adapters under
an operator-owned allowlist of exact trip, source and pseudonymous record IDs.
MCP arguments, documents, email contents and checkpoints cannot change that
policy. The registry validates the whole batch before reading, reserves a shared
adapter-call budget before awaiting, uses bounded deadlines and returns redacted
failures without automatic retries. Credentials are not tool arguments.

`agent/gmail-adapter.ts` implements the official `users.messages.get` read flow.
The operator supplies explicit message-to-record bindings, an OAuth token callback
from their secret manager and a local email normalizer. The adapter uses only a
fixed HTTPS Gmail endpoint, rejects redirects, omits cookies, bounds streamed
responses, decodes canonical base64url and returns normalized observations rather
than email headers or raw booking references. It does not search the whole inbox,
send, modify or delete messages. Google authentication does not authenticate the
truth of a reservation claimed in a message.

| Source         | Authorized connection                                                                               | Important boundary                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Gmail          | Operator-authorized read-only OAuth plus exact message bindings                                     | Body access needs an appropriate scope; public apps may require Google's verification.    |
| Airline        | Reviewed official adapter, or traveler-supplied voucher/email/export                                | Airline-specific commercial access and contracts are not interchangeable.                 |
| Booking.com    | Managed affiliate/API agreement and a reviewed partner adapter; otherwise traveler-supplied records | A consumer login is not a Demand API credential. No account scraping.                     |
| Airbnb         | Approved API program when applicable, or a traveler-requested data export                           | No undocumented endpoint, browser-session extraction or universal account API is claimed. |
| Other supplier | Reviewed adapter implementing `TravelReadAdapter`, or local export                                  | Declare permission, source format, costs, freshness and terms before installation.        |

Reconciliation compares dates, status, currencies, totals, reference tokens and
policy hashes for a traveler-selected record. Unknown values remain unknown;
explicit zero stays zero; conflicts remain conflicts even when one source is
newer. Agreement is `agreed_unverified`, not proof of delivery or authenticity.
Keep raw records, identity data, localizers and the reference-token secret in the
operator's private storage. Never publish exports, logs or credentials in Git.

Adapters are trusted deployed program code, not sandboxed JavaScript plugins.
They must honor abort signals and their own transport limits. A timeout ends the
registry's wait but cannot forcibly stop arbitrary code that ignores cancellation.
The shared budget counts adapter invocations; transport requests inside a batch
must have their own bound. The Gmail adapter permits at most twenty messages per
invocation. Do not advertise a global HTTP/token quota from these counters alone.

Official references checked 2026-10-31:

- [Gmail message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).
- [Gmail OAuth scope classification and verification](https://developers.google.com/workspace/gmail/api/auth/scopes).
- [Booking.com Demand API prerequisites](https://developers.booking.com/demand/docs/getting-started/prerequisites).
- [Airbnb API program terms](https://www.airbnb.com/help/article/3418).
- [Airbnb data export](https://www.airbnb.com/help/article/2985).

Network tests use synthetic mocked responses. No personal mailbox, airline,
Booking.com or Airbnb account was accessed to validate this implementation.

## Executable operator profile

Use the reviewed loader in docs/OPERATOR_PROFILE.md and scripts/agent-operator.mjs.
The default scripts/agent-mcp.mjs remains offline. Prepare Python dependencies
with `uv sync --project ingest --locked` before enabling Gmail. Email normalization
uses an absolute prepared Python interpreter with isolated mode and a fixed
working directory; it never searches PATH/cwd for uv or installs dependencies
while processing a message. Credentials and raw messages go only over private
pipes to the reviewed parser. MIME extracts only supported explicit literal
labels; unsupported vendor layouts remain unknown and require another reviewed
normalizer or private host-assisted extraction. PDFs/images are not opened as mail
attachments. The parser does not authenticate senders, reservations or prices.
