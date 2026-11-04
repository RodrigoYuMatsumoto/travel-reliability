"""Listing and catalogue pages: candidate trips for discovery, never a full observation.

Each candidate is ``{url, title, departureDate, priceFromMinor}``. Candidate URLs must stay
on the listing's own host over https; anything else (including WhatsApp links) is skipped.
``departureDate`` is filled only when the card writes the year; otherwise it stays None.
"""

from __future__ import annotations

import re
from datetime import date
from urllib.parse import parse_qs, urljoin, urlsplit

from bs4 import Tag

from .common import (
    INSTRUCTION,
    Document,
    first_money,
    has_contact,
    lines_of,
    money_minor,
    norm,
    strip_decoration,
)
from .errors import PackageError

# The Node bridge accepts at most 60 candidates; extra cards are dropped in document order.
MAX_CANDIDATES = 60
_DATED = re.compile(r"(?<![\d/])(?P<d>\d{1,2})/(?P<m>\d{1,2})/(?P<y>\d{4}|\d{2})(?![\d/])")
_HEADINGS = ("h1", "h2", "h3", "h4", "h5", "h6")


def _atrativa_detail(url: str) -> bool:
    parts = urlsplit(url)
    values = parse_qs(parts.query).get("v", [])
    return parts.path.endswith("/viagem.php") and len(values) == 1 and values[0].isdigit()


def _valle_detail(url: str) -> bool:
    return bool(re.fullmatch(r"/home/[^/?#]+-p\d+/?", urlsplit(url).path))


def _augustus_detail(url: str) -> bool:
    return bool(re.fullmatch(r"/pacote/\d+/?", urlsplit(url).fragment))


def _same_host(candidate: str, page_url: str) -> bool:
    left, right = urlsplit(candidate), urlsplit(page_url)
    return left.scheme == "https" and left.hostname == right.hostname and left.port == right.port


def _clean_title(raw: str | None) -> str | None:
    if not raw:
        return None
    text = strip_decoration(raw)
    if not text or has_contact(text) or INSTRUCTION.search(text):
        return None
    return text[:300].rstrip() or None


def _card_date(text: str) -> str | None:
    for match in _DATED.finditer(text):
        year = int(match["y"]) + (2000 if len(match["y"]) == 2 else 0)
        try:
            return date(year, int(match["m"]), int(match["d"])).isoformat()
        except ValueError:
            continue
    return None


def _candidate(card: Tag, link_text: str, absolute: str) -> dict:
    heading = next((node for node in card.find_all(_HEADINGS)), None)
    title = _clean_title(norm(heading.get_text(" ")) if heading else link_text)
    text = " ".join(lines_of(card))
    price_node = card.select_one(".big, .price, .preco, .valor")
    money = first_money(norm(price_node.get_text(" "))) if price_node else None
    money = money or first_money(text)
    return {
        "url": absolute,
        "title": title,
        "departureDate": _card_date(text),
        "priceFromMinor": money_minor(money) if money else None,
    }


def _linked_cards(doc: Document, page_url: str, is_detail) -> list[dict]:
    links: list[tuple[Tag, str]] = []
    for anchor in doc.soup.find_all("a", href=True):
        href = str(anchor["href"]).strip()
        if not href:
            continue
        absolute = urljoin(page_url, href)
        if not _same_host(absolute, page_url) or not is_detail(absolute) or len(absolute) > 2048:
            continue
        links.append((anchor, absolute))
    targets = {absolute for _, absolute in links}
    out: list[dict] = []
    seen: set[str] = set()
    for anchor, absolute in links:
        if absolute in seen:
            continue
        seen.add(absolute)
        card = anchor
        while isinstance(card.parent, Tag) and card.parent.name not in ("body", "html", "[document]"):
            inside = {
                urljoin(page_url, str(a["href"]).strip()) for a in card.parent.find_all("a", href=True)
            } & targets
            if inside - {absolute}:
                break
            card = card.parent
        out.append(_candidate(card, norm(anchor.get_text(" ")), absolute))
        if len(out) >= MAX_CANDIDATES:
            break
    return out


def _augustus_cards(doc: Document, page_url: str) -> list[dict]:
    out: list[dict] = []
    seen: set[str] = set()
    for grid in doc.soup.select(".pkg-grid"):
        for card in grid.find_all(True, recursive=False):
            link = card if card.name == "a" and card.has_attr("href") else card.find("a", href=True)
            if link is None:
                continue
            absolute = urljoin(page_url, str(link["href"]).strip())
            if not _same_host(absolute, page_url) or not _augustus_detail(absolute) or absolute in seen:
                continue
            seen.add(absolute)
            out.append(_candidate(card, norm(link.get_text(" ")), absolute))
            if len(out) >= MAX_CANDIDATES:
                return out
    return out


def listing_candidates(doc: Document, page_url: str, site: str, retrieval: str) -> list[dict]:
    if site == "atrativa":
        return _linked_cards(doc, page_url, _atrativa_detail)
    if site == "valle":
        return _linked_cards(doc, page_url, _valle_detail)
    if site == "augustus":
        if retrieval == "static_html":
            raise PackageError("RENDER_REQUIRED")
        return _augustus_cards(doc, page_url)
    raise PackageError("LISTING_NOT_SUPPORTED")
