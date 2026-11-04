"""Viajantes do Valle: Wix-like store pages (``/home/<slug>-p<id>``).

The product JSON-LD (``@type: Product``) is read with ``json.loads`` only; nothing runs.
Its ``description`` carries emoji-prefixed lines such as ``Quando: 24/12 a 27/12``,
``Local:``, ``Valor:``, ``Hospedagem:``, ``Saída:``, ``Chegada:``, ``Retorno:``,
``Locais de Embarque:`` and an ``Itens Inclusos`` block. Years are not written on this site.
"""

from __future__ import annotations

import json
import re
from datetime import date

from .common import (
    MONEY_RE,
    NUMERIC_MOMENT_RE,
    Document,
    Observation,
    block_lines,
    clock,
    decimal_minor,
    find_label,
    first_heading,
    first_money,
    money_minor,
    put_breakfast,
    put_days_nights,
    put_installments,
    put_lodging_nights,
    put_mandatory_fees,
    put_modal,
    put_price_amount,
    scan_lodging_may_change,
    split_items,
    text_lines,
)

_RANGE = re.compile(
    r"(?P<d>\d{1,2})/(?P<m>\d{1,2})(?:/(?P<y>\d{4}|\d{2}))?\s*(?:a|at[ée]|-)\s*"
    r"(?P<d2>\d{1,2})/(?P<m2>\d{1,2})(?:/(?P<y2>\d{4}|\d{2}))?(?![\d/])",
    re.I,
)
_MOMENT_LABEL = re.compile(r"^\W*(?P<label>Sa[íi]da|Chegada|Retorno)\s*:\s*", re.I)
_INCLUDED_START = re.compile(r"^\W*Itens\s+Inclusos\b\s*:?", re.I)
_EXCLUDED_START = re.compile(r"^\W*(?:Itens\s+)?N[ãa]o\s+Inclusos?\b\s*:?", re.I)
_STOP = re.compile(
    r"^\W*(?:Itens\s+(?:N[ãa]o\s+)?Inclusos|N[ãa]o\s+Inclus|\*?\s*obs\b|Observa|Locais\s+de\s+Embarque"
    r"|Valor\b|Sa[íi]da\b|Chegada\b|Retorno\b|Quando\b|Local\b|Hospedagem\s*:|Pol[íi]tica|Formas?\s+de\s+pagamento"
    r"|Reservas?\b|Importante|Roteiro|Programa[çc][ãa]o)",
    re.I,
)


def _walk(node, depth: int = 0):
    if depth > 8:
        return
    if isinstance(node, dict):
        yield node
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in node:
                yield from _walk(node[key], depth + 1)
    elif isinstance(node, list):
        for item in node[:200]:
            yield from _walk(item, depth + 1)


MAX_JSONLD_DEPTH = 64


def _nesting_exceeds(raw: str, limit: int = MAX_JSONLD_DEPTH) -> bool:
    """Bracket depth outside strings, scanned iteratively before json.loads.

    The recursion limit of the C JSON decoder differs between platforms (a 5000-deep
    array fails on Windows and parses on Linux), so the limit is the project's own.
    """
    depth, in_string, escaped = 0, False, False
    for char in raw:
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
        elif char == '"':
            in_string = True
        elif char in "[{":
            depth += 1
            if depth > limit:
                return True
        elif char in "]}":
            depth -= 1
    return False


def _product(doc: Document, obs: Observation) -> dict | None:
    for raw in doc.jsonld:
        if _nesting_exceeds(raw):
            obs.warn("JSONLD_INVALID")
            continue
        try:
            data = json.loads(raw)
        except (ValueError, RecursionError):
            obs.warn("JSONLD_INVALID")
            continue
        for node in _walk(data):
            kind = node.get("@type")
            if kind == "Product" or (isinstance(kind, list) and "Product" in kind):
                return node
    return None


def _offer_price(product: dict, obs: Observation) -> tuple[int, str, str] | None:
    """(minor, qualifier, literal value) from the JSON-LD offer, when it is in BRL.

    A malformed or absurd number (for example ``1E+1000000``) is refused with
    ``PRICE_INVALID``; it never becomes a value and never raises.
    """
    offers = product.get("offers")
    for offer in offers[:50] if isinstance(offers, list) else [offers]:
        if not isinstance(offer, dict) or offer.get("priceCurrency") != "BRL":
            continue
        for key, qualifier in (("price", "exact"), ("lowPrice", "from")):
            raw = offer.get(key)
            if raw is None:
                continue
            minor = decimal_minor(raw)
            if minor is None:
                obs.warn("PRICE_INVALID")
                continue
            return minor, qualifier, str(raw)
    return None


def parse(doc: Document, obs: Observation, retrieval: str) -> None:
    product = _product(doc, obs)
    page_lines = doc.lines()
    if product is None:
        obs.warn("JSONLD_PRODUCT_MISSING")
        title = first_heading(doc, ("h1",)) or doc.head_title or None
        lines = page_lines
    else:
        name = product.get("name")
        title = name if isinstance(name, str) else first_heading(doc, ("h1",))
        description = product.get("description")
        lines = text_lines(description) if isinstance(description, str) else page_lines
    obs.put_text("title", title, 300)
    title = obs.data["title"] or ""

    put_days_nights(obs, [title, *lines])

    destination = find_label(lines, r"Local", colon=True)
    if destination:
        obs.put_text("destination", destination.value, 200, destination.quote)

    _moments(obs, lines, title)
    _price(obs, lines, product)

    lodging = find_label(lines, r"Hospedagem", colon=True)
    if lodging:
        name = re.sub(r"\s*\([^)]*\)\s*$", "", lodging.value).strip() or lodging.value
        obs.put_text("lodging.name", name, 200, lodging.quote)

    boarding = find_label(lines, r"Locais\s+de\s+Embarque", colon=True)
    if boarding:
        cities = [part for part in re.split(r"\s*[/;|]\s*", boarding.value) if part.strip()]
        obs.put_list("boardingCities", cities, 80, 20, boarding.quote)

    included_lines, included_quote = block_lines(lines, _INCLUDED_START, _STOP)
    excluded_lines, excluded_quote = block_lines(lines, _EXCLUDED_START, _STOP)
    obs.put_list("included", split_items(included_lines), 160, 40, included_quote)
    obs.put_list("excluded", split_items(excluded_lines), 160, 40, excluded_quote)
    kept_included = obs.data["included"]
    transport = [line for line in lines if re.search(r"transporte|viagem\s+em|[ôo]nibus|a[ée]re", line, re.I)]
    put_modal(obs, [*kept_included, title, *transport])
    put_breakfast(obs, kept_included, obs.data["excluded"])
    put_lodging_nights(obs, kept_included)
    put_mandatory_fees(obs, lines)
    scan_lodging_may_change(obs, [*lines, *page_lines])


def _moments(obs: Observation, lines: list[str], title: str) -> None:
    """Saída -> departure; Retorno -> return departure; a Chegada after Retorno -> return arrival."""
    seen_return = False
    found: dict[str, tuple[re.Match, str]] = {}
    for line in lines:
        label = _MOMENT_LABEL.search(line)
        if not label:
            continue
        kind = label["label"].lower()
        value = line[label.end() :]
        match = NUMERIC_MOMENT_RE.match(value)
        if not match:
            continue
        quote = line[label.start() :]
        if kind.startswith("sa") and "departure" not in found:
            found["departure"] = (match, quote)
        elif kind == "retorno" and "returnDeparture" not in found:
            found["returnDeparture"] = (match, quote)
            seen_return = True
        elif kind == "chegada" and seen_return and "returnArrival" not in found:
            found["returnArrival"] = (match, quote)

    when = find_label(lines, r"Quando", colon=True)
    when_range = _RANGE.search(when.value) if when else None
    when_quote = when.quote if when else ""
    if when_range is None:
        when_range = _RANGE.search(title)
        when_quote = title

    if "departure" in found:
        match, quote = found["departure"]
        iso, stated = obs.resolve_date(match["d"], match["m"], match["y"], obs.observed_date)
        obs.put_moment("departure", iso, stated, clock(match["hh"], match["mm"]), quote)
    elif when_range:
        iso, stated = obs.resolve_date(when_range["d"], when_range["m"], when_range["y"], obs.observed_date)
        obs.put_moment("departure", iso, stated, None, when_quote)

    if "returnDeparture" in found:
        match, quote = found["returnDeparture"]
        iso, stated = obs.resolve_date(match["d"], match["m"], match["y"], obs.return_anchor())
        obs.put_moment("returnDeparture", iso, stated, clock(match["hh"], match["mm"]), quote)
    elif when_range:
        iso, stated = obs.resolve_date(
            when_range["d2"], when_range["m2"], when_range["y2"], obs.return_anchor()
        )
        obs.put_moment("returnDeparture", iso, stated, None, when_quote)

    if "returnArrival" in found:
        match, quote = found["returnArrival"]
        anchor_date = obs.data["returnDeparture"]["date"]
        anchor = obs.return_anchor()
        if anchor_date:
            anchor = max(anchor, date.fromisoformat(anchor_date))
        iso, stated = obs.resolve_date(match["d"], match["m"], match["y"], anchor)
        obs.put_moment("returnArrival", iso, stated, clock(match["hh"], match["mm"]), quote)


def _price(obs: Observation, lines: list[str], product: dict | None) -> None:
    offer = _offer_price(product, obs) if product else None
    value = find_label(lines, r"Valor|Pre[çc]o|Investimento", colon=True)
    money = first_money(value.value) if value else None
    if value and money:
        qualifier = "from" if re.search(r"a\s+partir\s+de", value.quote, re.I) else "exact"
        put_price_amount(obs, money, value.quote, qualifier, value.value)
        put_installments(obs, value.quote)
        if offer and offer[0] != money_minor(money):
            obs.warn("MULTIPLE_PRICES_ON_PAGE")
    elif offer:
        minor, qualifier, literal = offer
        if obs.put("price.amountMinor", minor, literal):
            obs.put("price.qualifier", qualifier, literal)
            obs.warn("PRICE_BASIS_UNKNOWN")
    elif any(MONEY_RE.search(line) for line in lines):
        obs.warn("PRICE_LABEL_NOT_RECOGNISED")
