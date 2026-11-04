"""Atrativa Tur: server-rendered PHP pages (``viagem.php?v=N`` detail pages).

Recognised labels: ``Saída:``, ``Chegada:`` (arrival back at the origin), ``Acomodação:``,
``Valor à vista:``, ``Valor à prazo:``, an ``INCLUSO`` block and a ``NÃO INCLUSOS`` block.
"""

from __future__ import annotations

import re

from .common import (
    Document,
    Observation,
    block_lines,
    find_label,
    find_numeric_moment,
    first_heading,
    first_money,
    put_breakfast,
    put_days_nights,
    put_installments,
    put_lodging_nights,
    put_mandatory_fees,
    put_modal,
    put_numeric_moment,
    put_price_amount,
    scan_lodging_may_change,
    split_items,
)

_INCLUDED_START = re.compile(r"^\W*INCLUSOS?\b\s*:?", re.I)
_EXCLUDED_START = re.compile(r"^\W*N[ÃAãa]O\s+INCLUS[OA]S?\b\s*:?", re.I)
_STOP = re.compile(
    r"^\W*(?:N[ÃAãa]O\s+INCLUS|INCLUSOS?\b|Valor\b|Acomoda|Sa[íi]da\b|Chegada\b|Retorno\b"
    r"|Observa|OBS\b|Roteiro|Formas?\s+de\s+pagamento|Pol[íi]tica|Documenta|Importante|Locais\b|Embarque)",
    re.I,
)


def parse(doc: Document, obs: Observation, retrieval: str) -> None:
    lines = doc.lines()
    title = first_heading(doc, ("h1", "h2")) or doc.head_title or None
    obs.put_text("title", title, 300)
    destination = find_label(lines, r"Destino", colon=True)
    if destination:
        obs.put_text("destination", destination.value, 200, destination.quote)

    put_numeric_moment(
        obs, "departure", find_numeric_moment(lines, r"Sa[íi]da", colon=True), obs.observed_date
    )
    put_numeric_moment(
        obs, "returnDeparture", find_numeric_moment(lines, r"Retorno", colon=True), obs.return_anchor()
    )
    put_numeric_moment(
        obs, "returnArrival", find_numeric_moment(lines, r"Chegada", colon=True), obs.return_anchor()
    )

    lodging = find_label(lines, r"Acomoda[çc][ãa]o", colon=True)
    if lodging:
        obs.put_text("lodging.name", lodging.value, 200, lodging.quote)

    cash = find_label(lines, r"Valor\s+[àa]\s+vista", colon=False)
    if cash:
        money = first_money(cash.value)
        if money:
            put_price_amount(obs, money, cash.quote, "exact", cash.value)
    term = find_label(lines, r"Valor\s+[àa]\s+prazo", colon=False)
    if term:
        put_installments(obs, term.quote)

    included_lines, included_quote = block_lines(lines, _INCLUDED_START, _STOP)
    excluded_lines, excluded_quote = block_lines(lines, _EXCLUDED_START, _STOP)
    included = split_items(included_lines)
    excluded = split_items(excluded_lines)
    obs.put_list("included", included, 160, 40, included_quote)
    obs.put_list("excluded", excluded, 160, 40, excluded_quote)
    kept_included = obs.data["included"]
    kept_excluded = obs.data["excluded"]

    put_modal(obs, [*kept_included, title or ""])
    put_breakfast(obs, kept_included, kept_excluded)
    put_lodging_nights(obs, kept_included)
    put_days_nights(obs, [title or ""])
    put_mandatory_fees(obs, lines)
    scan_lodging_may_change(obs, lines)
