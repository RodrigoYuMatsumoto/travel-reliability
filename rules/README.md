# Dated rule packs

The initial Brazil pack is deliberately limited to documented disruption assistance. It is not a
complete legal opinion, compensation calculator or determination of civil liability.

- `validFrom` is inclusive; `validTo` is exclusive. The event date selects the rule.
- Unknown scope, relevant exceptions, refund choice or stale verification produces `needs_review`.
- ANAC Resolution 813/2026 revokes article 27(I) effective 2026-10-26. Do **not** report a current
  one-hour communication-assistance entitlement from the old table.
- ANAC Resolution 819/2026 separates the 2026-10-26 and 2026-11-25 effective dates.
- Events before 2026-10-26 keep the original food (over two hours) and lodging (over four hours)
  entries; the original article 20 information duty applies until 2026-11-25.
- From 2026-10-26 the article 27 caput limits material assistance to Brazilian national territory.
  The contract does not record where a wait happened, so these entries return `needs_review`.
- ANTT 6033/2023 applies here only to explicitly identified regular interstate bus service. Article
  179 alternatives cover departure delays over one hour, cancellations (article 178, III) and
  in-transit disruptions caused by the provider (article 178, V; unknown responsibility stays under
  review). A refund is one of those alternatives, so the passenger's choice does not affect them.
- Article 181 continuity, meals and transfers apply after three hours. Lodging is a separate entry
  that requires the trip to be unable to continue the same day; a resident of the origin may receive
  round-trip transfers instead (paragraph 4), so a resident or unknown residence stays under review.
- Article 182 removes assistance after a full refund except incidents, accidents or robberies. The
  contract does not record those causes, so a refund choice keeps the assistance entries under review.
- New country packs require primary sources, applicability, exceptions, effective dates and boundary tests.
- Packs are bundled data evaluated by reviewed code, not scripts installed by a model.

Official sources and articles are stored with each rule. Reviewed on 2026-11-01 (ANTT read again on 2026-11-02); review due 2026-12-01.
CDC disclosure requirements and Cadastur applicability inform checklists, not automatic liability.
Privacy controls are engineering controls, not a claim of certified LGPD compliance.
