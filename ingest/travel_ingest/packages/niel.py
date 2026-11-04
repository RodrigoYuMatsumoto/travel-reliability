"""Niel Turismo on the suareservaonline platform.

Recognised structure: a ``<Destino> - NIEL TURISMO`` title, ``N dias e M noites``, a
``Saída dd de mmm`` / ``Volta dd de mmm`` line without year, boarding entries
(``Embarque 1º <Cidade> <ponto> dd/mm/aaaa às HHhMM``), ``A partir de R$ X /por pessoa``,
an ``INVESTIMENTO`` block (cash price and installments), ``TAXAS OBRIGATÓRIAS`` and a
``Serviços Inclusos`` block. The ``Atividades recomendadas`` section lists *other* packages
and is removed before anything is read.
"""

from __future__ import annotations

import re

from bs4 import NavigableString, Tag

from .common import (
    DAY_MONTH_RE,
    FULL_DATE_MOMENT_RE,
    Document,
    Observation,
    basis_of,
    block_lines,
    clock,
    find_label,
    find_labels,
    first_heading,
    first_money,
    money_minor,
    month_number,
    norm,
    put_breakfast,
    put_days_nights,
    put_installments,
    put_lodging_nights,
    put_mandatory_fees,
    put_modal,
    put_price_amount,
    scan_lodging_may_change,
    split_items,
)

_RECOMMENDATIONS_START = re.compile(r"^\W*Atividades\s+recomendadas\b", re.I)
_RECOMMENDATIONS_ANYWHERE = re.compile(r"\bAtividades\s+recomendadas\b", re.I)
_RECOMMENDATIONS_WORD = re.compile(r"Atividades|recomendadas", re.I)
# Fields that a leaked recommendation could corrupt; they are cleared when isolation fails.
_FAIL_CLOSED_FIELDS = (
    "departure",
    "returnDeparture",
    "returnArrival",
    "days",
    "nights",
    "price",
    "mandatoryFees",
)
_ROOTS = ("body", "html", "[document]", "main")
_SUFFIX = re.compile(r"\s*[-|]\s*NIEL\s+TURISMO\s*$", re.I)
_EMBARQUE = re.compile(r"^\s*Embarque\s*\d{1,2}\s*[º°ªo]?\s*:?", re.I)
_INCLUDED_START = re.compile(r"^\W*Servi[çc]os\s+Inclusos\b\s*:?", re.I)
_EXCLUDED_START = re.compile(r"^\W*(?:Servi[çc]os\s+)?N[ãa]o\s+Inclusos?\b\s*:?", re.I)
_STOP = re.compile(
    r"^\W*(?:Servi[çc]os\s+(?:N[ãa]o\s+)?Inclusos|N[ãa]o\s+Inclus|TAXAS?\b|INVESTIMENTO|Embarque"
    r"|Observa|Pol[íi]tica|Roteiro|Itiner[áa]rio|Atividades|Sa[íi]da\b|A\s+partir\s+de|Pacotes?\s+Tur"
    r"|Formas?\s+de\s+pagamento|Documenta|Importante|Cancelamento)",
    re.I,
)


def _recommendation_headings(doc: Document) -> list[Tag]:
    """Innermost elements whose aggregated text starts with ``Atividades recomendadas``.

    The phrase may be split across inline tags (``Atividades <strong>recomendadas</strong>``)
    or followed by more words (``Atividades recomendadas (2)``, ``... para você``).
    """
    headings: list[Tag] = []
    for text in doc.soup.find_all(string=_RECOMMENDATIONS_WORD):
        node = getattr(text, "parent", None)
        depth = 0
        while isinstance(node, Tag) and node.name not in _ROOTS and depth < 4:
            if _RECOMMENDATIONS_START.match(norm(node.get_text(" "))):
                if not any(node is heading for heading in headings):
                    headings.append(node)
                break
            node = node.parent
            depth += 1
    return headings


def _drop_recommendations(doc: Document) -> bool:
    """Remove every ``Atividades recomendadas`` section (heading plus the content it introduces).

    The removed container is the nearest ancestor that starts with the heading and looks like
    a section (``section``/``aside``/``article`` or a class/id naming recommendations); when
    the heading stands alone in its wrapper, the wrapper's following siblings go with it.
    """
    found = False
    for heading in _recommendation_headings(doc):
        if getattr(heading, "decomposed", False) or heading.parent is None:
            continue
        found = True
        heading_text = norm(heading.get_text(" "))
        while (
            isinstance(heading.parent, Tag)
            and heading.parent.name not in _ROOTS
            and norm(heading.parent.get_text(" ")) == heading_text
        ):
            heading = heading.parent
        # Candidate containers start with the heading and never hold the page's own content
        # (``main`` or ``h1``): removing one of those would erase the package itself.
        chain: list[Tag] = []
        node = heading
        while (
            isinstance(node.parent, Tag)
            and node.parent.name not in _ROOTS
            and _starts_with(node.parent, heading)
            and not _holds_main_content(node.parent)
        ):
            node = node.parent
            chain.append(node)
        container = next((item for item in chain if _is_section(item)), chain[0] if chain else heading)
        if norm(container.get_text(" ")) == heading_text:
            # The heading stands alone: the cards are its following siblings, up to the
            # page's own content.
            for sibling in list(container.find_next_siblings()):
                if _holds_main_content(sibling):
                    break
                sibling.decompose()
        container.decompose()
    return found


def _holds_main_content(node: Tag) -> bool:
    return node.name in ("main", "h1") or node.find(["main", "h1"]) is not None


def _recommendations_left(doc: Document) -> bool:
    return bool(_RECOMMENDATIONS_ANYWHERE.search(norm(doc.soup.get_text(" "))))


def _is_section(node: Tag) -> bool:
    if node.name in ("section", "aside", "article"):
        return True
    names = " ".join([*node.get("class", []), str(node.get("id", ""))])
    return bool(re.search(r"recomend|relacionad|sugest|related|recommend", names, re.I))


def _starts_with(container: Tag, heading: Tag) -> bool:
    """True when the first visible text inside ``container`` belongs to ``heading``."""
    for text in container.find_all(string=True):
        if isinstance(text, NavigableString) and norm(text):
            # Identity, not equality: bs4 compares tags structurally.
            return any(parent is heading for parent in text.parents)
    return False


def _boardings(doc: Document) -> list[dict]:
    entries: list[dict] = []
    seen: list[Tag] = []
    for label in doc.soup.find_all(string=_EMBARQUE):
        # The entry is the closest ancestor (at most four levels up) that also holds its date;
        # without a dated ancestor the entry stays local to the label.
        container = label.parent
        depth = 0
        while (
            isinstance(container, Tag)
            and container.name not in _ROOTS
            and depth < 4
            and not FULL_DATE_MOMENT_RE.search(norm(container.get_text(" ")))
        ):
            container = container.parent
            depth += 1
        if (
            not isinstance(container, Tag)
            or container.name in _ROOTS
            or not FULL_DATE_MOMENT_RE.search(norm(container.get_text(" ")))
        ):
            container = label.parent
        if not isinstance(container, Tag) or any(container is item for item in seen):
            continue
        if len(re.findall(r"Embarque\s*\d", container.get_text(" "), re.I)) > 1:
            continue
        seen.append(container)
        segments = [norm(text) for text in container.stripped_strings if norm(text)]
        start = next((i for i, segment in enumerate(segments) if _EMBARQUE.match(segment)), None)
        if start is None:
            continue
        joined = " ".join(segments[start:])
        moment = FULL_DATE_MOMENT_RE.search(joined)
        label_match = _EMBARQUE.match(segments[start])
        remainder = segments[start][label_match.end() :].strip()
        city = None
        ambiguous = False
        if remainder:
            ambiguous = bool(FULL_DATE_MOMENT_RE.search(remainder))
            city = None if ambiguous else remainder
        elif start + 1 < len(segments) and not FULL_DATE_MOMENT_RE.search(segments[start + 1]):
            city = segments[start + 1]
        else:
            ambiguous = True
        entries.append({"city": city, "ambiguous": ambiguous, "moment": moment, "quote": joined})
    return entries


def _day_month(lines: list[str], label: str):
    for hit in find_labels(lines, label):
        match = DAY_MONTH_RE.match(hit.value)
        if match and month_number(match["mon"]):
            return match, hit
    return None


def parse(doc: Document, obs: Observation, retrieval: str) -> None:
    if _drop_recommendations(doc):
        obs.warn("RECOMMENDATIONS_IGNORED")
    # Fail closed: if the section could not be isolated, its dates and prices may have leaked.
    isolated = not _recommendations_left(doc)
    if not isolated:
        obs.warn("RECOMMENDATIONS_NOT_ISOLATED")
    lines = doc.lines()

    title = first_heading(doc, ("h1",)) or doc.head_title or None
    obs.put_text("title", title, 300)
    for candidate in (doc.head_title, title):
        if candidate and _SUFFIX.search(candidate):
            obs.put_text("destination", _SUFFIX.sub("", candidate), 200, candidate)
            break

    put_days_nights(obs, [line for line in lines if re.search(r"\bPacotes?\b", line, re.I)] + [title or ""])

    # Departure: the boarding entry that matches the "Saída" day carries the stated year.
    boardings = _boardings(doc)
    saida = _day_month(lines, r"Sa[íi]da")
    dated = [entry for entry in boardings if entry["moment"]]
    chosen = None
    if saida:
        day, month = int(saida[0]["d"]), month_number(saida[0]["mon"])
        chosen = next(
            (e for e in dated if (int(e["moment"]["d"]), int(e["moment"]["m"])) == (day, month)),
            None,
        )
        if chosen is None:
            iso, stated = obs.resolve_date(saida[0]["d"], month, saida[0]["y"], obs.observed_date)
            obs.put_moment("departure", iso, stated, None, saida[1].quote)
            if dated:
                obs.warn("BOARDING_DATE_MISMATCH")
    elif dated:
        chosen = dated[0]
    if chosen is not None:
        moment = chosen["moment"]
        iso, stated = obs.resolve_date(moment["d"], moment["m"], moment["y"], obs.observed_date)
        quote = chosen["quote"]
        obs.put_moment("departure", iso, stated, clock(moment["hh"], moment["mm"]), quote)

    volta = _day_month(lines, r"Volta")
    if volta:
        iso, stated = obs.resolve_date(
            volta[0]["d"], month_number(volta[0]["mon"]), volta[0]["y"], obs.return_anchor()
        )
        obs.put_moment("returnDeparture", iso, stated, None, volta[1].quote)
        if iso:
            obs.warn("RETURN_DATE_ROLE_ASSUMED")

    cities = [entry["city"] for entry in boardings if entry["city"]]
    if any(entry["ambiguous"] for entry in boardings):
        obs.warn("BOARDING_CITY_AMBIGUOUS")
    if cities:
        first = next(entry for entry in boardings if entry["city"])
        obs.put_list("boardingCities", cities, 80, 20, first["quote"])

    _price(obs, lines)

    included_lines, included_quote = block_lines(lines, _INCLUDED_START, _STOP)
    excluded_lines, excluded_quote = block_lines(lines, _EXCLUDED_START, _STOP)
    obs.put_list("included", split_items(included_lines), 160, 40, included_quote)
    obs.put_list("excluded", split_items(excluded_lines), 160, 40, excluded_quote)
    kept_included = obs.data["included"]
    put_modal(obs, [*kept_included, title or ""])
    put_breakfast(obs, kept_included, obs.data["excluded"])
    put_lodging_nights(obs, kept_included)
    lodging = find_label(lines, r"Hospedagem|Hotel", colon=True)
    if lodging:
        obs.put_text("lodging.name", lodging.value, 200, lodging.quote)
    put_mandatory_fees(obs, lines)
    scan_lodging_may_change(obs, lines)
    if not isolated:
        obs.reset(_FAIL_CLOSED_FIELDS)


def _price(obs: Observation, lines: list[str]) -> None:
    from_hit = find_label(lines, r"A\s+partir\s+de")
    from_money = first_money(from_hit.value) if from_hit else None
    from_context = ""
    if from_hit:
        from_context = from_hit.quote
        following = lines[from_hit.index + 1] if from_hit.index + 1 < len(lines) else ""
        if basis_of(from_context) == "unknown" and re.match(r"^\s*(?:/|por\b|p/)", following, re.I):
            from_context = f"{from_context} {following}"

    exact = None
    invest_index = next(
        (i for i, line in enumerate(lines) if re.match(r"^\W*INVESTIMENTO\b", line, re.I)), None
    )
    if invest_index is not None:
        block = [lines[invest_index]]
        for following in lines[invest_index + 1 : invest_index + 4]:
            if _STOP.search(following):
                break
            block.append(following)
        segment = " ".join(block)
        cash = re.search(r"[àa]\s+vista\s*:?\s*", segment, re.I)
        money = first_money(segment[cash.end() :] if cash else segment)
        if money:
            exact = (money, segment[cash.end() :] if cash else segment, segment)

    if exact:
        money, searched, segment = exact
        basis_text = segment
        same = from_money is not None and money_minor(from_money) == money_minor(money)
        basis_quote = None
        if basis_of(segment) == "unknown" and same and basis_of(from_context[:160]) != "unknown":
            basis_text, basis_quote = from_context[:160], from_context
        put_price_amount(obs, money, segment, "exact", basis_text, basis_quote)
        put_installments(obs, searched)
        if from_money is not None and not same:
            obs.warn("MULTIPLE_PRICES_ON_PAGE")
    elif from_money is not None:
        put_price_amount(obs, from_money, from_context, "from", from_context[:160], from_context)
        put_installments(obs, from_context)
