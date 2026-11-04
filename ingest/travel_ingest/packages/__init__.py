"""Deterministic extraction of literal observations from regional bus-package pages.

Supported agencies: Atrativa Tur, Niel Turismo (suareservaonline), Viajantes do Valle and
Augustus Turismo. The extractor never compares, calculates or guesses: unknown values stay
``None`` and every non-null value carries a literal evidence quote. Output follows
``schema/src/package-observation.ts`` (``package-observation/1``).
"""

from __future__ import annotations

import hashlib
from urllib.parse import urlsplit

from . import atrativa, augustus, generic, niel, valle
from .common import (
    Document,
    Observation,
    check_html,
    check_observed_at,
    check_retrieval,
    check_site,
    check_url,
)
from .contract import validate_observation
from .errors import PackageError
from .listing import listing_candidates

__all__ = ["PackageError", "detect_site", "parse_listing", "parse_package", "validate_observation"]

_PARSERS = {
    "atrativa": atrativa.parse,
    "niel": niel.parse,
    "valle": valle.parse,
    "augustus": augustus.parse,
    "generic": generic.parse,
}


def _host(url: str) -> str:
    try:
        host = urlsplit(url.strip()).hostname or ""
    except ValueError:
        raise PackageError("URL_INVALID") from None
    return host.lower().rstrip(".")


def detect_site(url: str) -> str:
    """Map a URL to a site key. Instagram is refused: it requires login and forbids scraping."""
    if not isinstance(url, str):
        raise PackageError("URL_INVALID")
    host = _host(url)
    if host in ("instagram.com", "instagr.am") or host.endswith((".instagram.com", ".instagr.am")):
        raise PackageError("INSTAGRAM_NOT_SUPPORTED")
    if host in ("atrativatur.com.br", "www.atrativatur.com.br"):
        return "atrativa"
    if host.endswith(".suareservaonline.com.br"):
        return "niel"
    if host in ("viajantesdovalle.com.br", "www.viajantesdovalle.com.br"):
        return "valle"
    if host in ("augustusturismo.com.br", "www.augustusturismo.com.br"):
        return "augustus"
    return "generic"


def _prepare(html: str, url: str, observed_at: str, retrieval: str, site: str | None):
    raw = check_html(html)
    url = check_url(url)
    detected = detect_site(url)
    chosen = check_site(site) if site is not None else detected
    observed_date = check_observed_at(observed_at)
    retrieval = check_retrieval(retrieval)
    return raw, url, chosen, observed_date, retrieval


def parse_package(html: str, *, url: str, observed_at: str, retrieval: str, site: str | None = None) -> dict:
    """Return one ``package-observation/1`` dictionary for a package detail page."""
    raw, url, chosen, observed_date, retrieval = _prepare(html, url, observed_at, retrieval, site)
    source = {
        "url": url,
        "site": chosen,
        "observedAt": observed_at,
        "retrieval": retrieval,
        "contentSha256": hashlib.sha256(raw).hexdigest(),
    }
    obs = Observation(source, observed_date)
    doc = Document(html)
    doc.scan_instructions()
    _PARSERS[chosen](doc, obs, retrieval)
    result = obs.finish(doc.warnings)
    if validate_observation(result):
        raise PackageError("OUTPUT_CONTRACT_VIOLATION")
    return result


def parse_listing(
    html: str, *, url: str, observed_at: str, retrieval: str, site: str | None = None
) -> list[dict]:
    """Return discovery candidates ``{url, title, departureDate, priceFromMinor}`` from a listing."""
    _, url, chosen, _, retrieval = _prepare(html, url, observed_at, retrieval, site)
    return listing_candidates(Document(html), url, chosen, retrieval)
