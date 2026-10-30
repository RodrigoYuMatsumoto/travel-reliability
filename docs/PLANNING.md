# Nine planning workflows

All tools operate on **supplied evidence**. They return `mode: documentary` and
`externalCalls: 0`. No provider inventory API is configured by default. The
portable prompts can guide a capable research host; this application never
claims those searches took place.

Use the interface's **Planning & allocation** tab, POST `/v1/tools/{tool}` with
session/CSRF headers, or run locally:

```sh
npm run plan -- group-split examples/group-split.json
```

See [JSON Schemas](../schema/planning.schema.json) and [synthetic examples](../examples/).
The CLI reads the indicated JSON as data, performs no external calls, and writes
the result to stdout. Store exports privately if using non-synthetic data.

| Tool             | Implemented calculation / boundary                                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flex-dates`     | Authorized date window, destination nights, group/service equivalence, known costs; changing the stay does not manufacture savings.                                                         |
| `airports`       | Explicit airport set and supplied ground time/distance constraints; both limits apply. No guessed airport radius or traffic time.                                                           |
| `connections`    | Offset-aware durations, separate-ticket/airport-change/overnight constraints, documented connection allowance, immigration/baggage/protection gaps. No guarantee of boarding.               |
| `promotions`     | Purchase window, eligibility/application state and comparable final-offer difference. No invented coupon, stacked incompatible benefit or credit/card acquisition.                          |
| `total-cost`     | Integer units × quantities; included/necessary/optional/conditional components, no duplicate IDs, totals by currency and explicit unknown required items.                                   |
| `fare-scenarios` | Normal spend, change-fee/issuer/fare/tax/services calculation, unknown new fare, cash refund and restricted credit kept distinct. No expected-loss probability or clause-validity decision. |
| `negotiation`    | Two factual enquiry drafts, optional comparison and material pending facts; no fabricated competitor, status, urgency or message sending.                                                   |
| `hidden-city`    | Nominal supplied-price comparison and six separate documentary risk topics; no universal legal classification, sanctions forecast or concealment instructions.                              |
| `group-split`    | Pseudonymous households/participants, explicit accepted beneficiary weights, integer-cent reconciliation, per-household ceilings/deficits, separate dated cash/card exposure.               |

## Money, sources and equivalence

Amounts are integer minor units in the stated currency. `null` is unknown, not
zero. Zero still needs a source. Points, restricted credit and currencies are
not silently converted. Normalize currency with a separately documented exchange
basis before comparison; automatic FX, coupon application and loyalty valuation
are outside v0.1.

Offer costs carry source IDs, units, quantities and treatment. Included items
are not added again; conditional/optional items count only when selected. A
required item without an evidenced price makes the final total indeterminate.
Minimum individual fares do not establish a group's price or seat availability.

Quantified savings require equivalent scope, complete totals, one matching
currency, unexpired explicit validity, observations no later than the evaluation
time and no more than one hour old, and confirmed group
capacity. The one-hour window is a conservative product comparison policy,
not evidence that an offer remains available. Different dates can be compared by
the flex-date tool only with equivalent destination nights and required services.
No universal cheapest-market or best-price claim is produced.

## Group allocation and cash

Use N01/N02 for households and P01/P02 for unique participants. A participant
cannot belong to two households. Shares are positive integer weights over the
declared beneficiaries. An exclusive car expense can name only its beneficiaries.
No rule is judged fair or imposed on the group.

For a fixed amount, largest-remainder allocation reconciles the entire amount;
ties use household ID. Unknown costs, missing evidence, unaccepted rules, expired
offers, capacity gaps or missing ceilings prevent unconditional eligibility.
Interval endpoint allocations reconcile each group endpoint; household bounds
use conservative floor/ceiling fractions because largest-remainder allocations
are not monotonic as the total changes. Estimates remain conditional even when
their supplied range fits a ceiling. Intervals are not market averages or invented
inflation. Household ceilings must refer to the same documented scope.

Cash flows are a separate ledger: payment, refund, deposit/return and card
hold/release. A down payment is part of an expense, not a second expense. A
refundable deposit is cash exposure, not ordinary travel spend. Peak values use
the chronological cumulative supplied flows; the application explicitly does
not certify the completeness of the payment schedule.

The API accepts up to nine destination/model scenarios. Unquoted or incompatible
cells stay conditional/ineligible; it does not fill a 3×3 matrix with invented
prices. Capacity, rooms, child equipment, accessibility, group work and supplier
conditions require documentary/human confirmation.
