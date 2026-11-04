"""Augustus Turismo: a JavaScript single-page app (hash route ``#/pacote/<id>``).

The static HTML is a shell whose inline script embeds *demonstration* packages with
fictitious prices. That script is never read: a static shell yields no values, only the
``STATIC_SHELL_NOT_EVIDENCE`` and ``RENDER_REQUIRED`` warnings. Values come only from the
rendered DOM (``.detail-info``, ``.summary-rows``, ``.price-box``).
"""

from __future__ import annotations

import re

from .common import (
    DAYS_NIGHTS_RE,
    NUMERIC_MOMENT_RE,
    Document,
    Observation,
    clock,
    find_label,
    first_money,
    lines_of,
    norm,
    put_days_nights,
    put_installments,
    put_modal,
    put_price_amount,
    scan_lodging_may_change,
)

_RENDERED_SELECTORS = (".detail-info", ".summary-rows", ".price-box")


def is_rendered(doc: Document) -> bool:
    return any(doc.soup.select_one(selector) is not None for selector in _RENDERED_SELECTORS)


def parse(doc: Document, obs: Observation, retrieval: str) -> None:
    if retrieval == "static_html" or not is_rendered(doc):
        obs.warn("STATIC_SHELL_NOT_EVIDENCE")
        obs.warn("RENDER_REQUIRED")
        return

    heading = doc.soup.select_one(".detail-info h1")
    title = norm(heading.get_text(" ")) if heading else None
    obs.put_text("title", title, 300)

    rows_node = doc.soup.select_one(".summary-rows")
    rows = lines_of(rows_node) if rows_node else []

    destination = find_label(rows, r"Destino", colon=True)
    location = doc.soup.select_one(".detail-loc")
    if destination:
        obs.put_text("destination", destination.value, 200, destination.quote)
    elif location:
        obs.put_text("destination", norm(location.get_text(" ")), 200)

    chips = [norm(chip.get_text(" ")) for chip in doc.soup.select(".info-chip")]
    put_days_nights(obs, [chip for chip in chips if DAYS_NIGHTS_RE.search(chip)][:1])
    if obs.data["days"] is None:
        duration = find_label(rows, r"Dura[çc][ãa]o", colon=True)
        days = re.match(r"\s*(\d{1,2})\s*dias?\b", duration.value, re.I) if duration else None
        if days and 1 <= int(days[1]) <= 60:
            obs.put("days", int(days[1]), duration.quote)

    _date(obs, rows, r"Data\s+de\s+sa[íi]da", "departure", obs.observed_date)
    if obs.data["departure"]["date"]:
        obs.warn("YEAR_MAY_BE_SITE_ADJUSTED")
    _date(obs, rows, r"Data\s+de\s+(?:chegada|retorno|volta)", "returnArrival", obs.return_anchor())
    if obs.data["returnArrival"]["date"]:
        obs.warn("RETURN_DATE_MAY_BE_COMPUTED")
        obs.warn("YEAR_MAY_BE_SITE_ADJUSTED")

    transport = find_label(rows, r"Transporte", colon=True)
    put_modal(obs, [transport.quote if transport else "", title or ""])

    hotel = find_label(rows, r"Hotel|Hospedagem", colon=True)
    if hotel:
        obs.put_text("lodging.name", hotel.value, 200, hotel.quote)

    regime = find_label(rows, r"Regime|Alimenta[çc][ãa]o", colon=True)
    if regime:
        value = regime.value.lower()
        if re.search(r"sem\s+caf|somente\s+hospedagem|sem\s+alimenta", value):
            obs.put("breakfast.status", "excluded", regime.quote)
        elif re.search(
            r"caf[ée]\s+da\s+manh[ãa]|meia\s+pens[ãa]o|pens[ãa]o\s+completa|all\s+inclusive", value
        ):
            obs.put("breakfast.status", "included", regime.quote)

    box = doc.soup.select_one(".price-box")
    if box is not None:
        box_text = " ".join(lines_of(box))
        big = box.select_one(".big")
        money = first_money(norm(big.get_text(" "))) if big else first_money(box_text)
        if money:
            put_price_amount(obs, money, box_text, "exact", box_text)
        instal = box.select_one(".instal")
        put_installments(obs, norm(instal.get_text(" ")) if instal else box_text)

    scan_lodging_may_change(obs, rows)


def _date(obs: Observation, rows: list[str], label: str, prefix: str, anchor) -> None:
    hit = find_label(rows, label, colon=True)
    if not hit:
        return
    match = NUMERIC_MOMENT_RE.match(hit.value)
    if not match:
        return
    iso, stated = obs.resolve_date(match["d"], match["m"], match["y"], anchor)
    obs.put_moment(prefix, iso, stated, clock(match["hh"], match["mm"]), hit.quote)
