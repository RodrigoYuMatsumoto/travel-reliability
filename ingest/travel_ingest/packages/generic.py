"""Conservative fallback for hosts without a dedicated parser.

Only explicit labels are read (``Saída:``, ``Retorno:``, ``Chegada:``, ``Valor:``/``Preço:``,
``A partir de``); everything else stays unknown and ``GENERIC_SITE_PARSER`` is emitted.
"""

from __future__ import annotations

import re

from .common import (
    Document,
    Observation,
    find_label,
    find_numeric_moment,
    first_heading,
    first_money,
    put_days_nights,
    put_installments,
    put_modal,
    put_numeric_moment,
    put_price_amount,
    scan_lodging_may_change,
)


def parse(doc: Document, obs: Observation, retrieval: str) -> None:
    obs.warn("GENERIC_SITE_PARSER")
    lines = doc.lines()
    title = first_heading(doc, ("h1",)) or doc.head_title or None
    obs.put_text("title", title, 300)
    title = obs.data["title"] or ""
    put_days_nights(obs, [title])
    put_modal(obs, [title])

    put_numeric_moment(
        obs, "departure", find_numeric_moment(lines, r"Sa[íi]da|Partida", colon=True), obs.observed_date
    )
    put_numeric_moment(
        obs, "returnDeparture", find_numeric_moment(lines, r"Retorno|Volta", colon=True), obs.return_anchor()
    )
    put_numeric_moment(
        obs, "returnArrival", find_numeric_moment(lines, r"Chegada", colon=True), obs.return_anchor()
    )

    price = find_label(lines, r"Valor|Pre[çc]o|Investimento", colon=True)
    money = first_money(price.value) if price else None
    if price and money:
        put_price_amount(obs, money, price.quote, "exact", price.value)
        put_installments(obs, price.quote)
    else:
        start = find_label(lines, r"A\s+partir\s+de")
        money = first_money(start.value) if start else None
        if start and money:
            put_price_amount(obs, money, start.quote, "from", start.value)
            put_installments(obs, start.quote)
    if obs.data["price"]["amountMinor"] is None and any(re.search(r"R\$\s*\d", line) for line in lines):
        obs.warn("PRICE_LABEL_NOT_RECOGNISED")
    scan_lodging_may_change(obs, lines)
