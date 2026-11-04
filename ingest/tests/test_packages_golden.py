"""Golden outputs for every synthetic fixture (byte-for-byte, sorted keys)."""

import json
import os
from pathlib import Path

import pytest

from travel_ingest.packages import parse_listing, parse_package, validate_observation
from travel_ingest.packages.cli import dumps

FIXTURES = Path(__file__).parent / "fixtures" / "packages"
EXPECTED = FIXTURES / "expected"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"
UPDATE = os.environ.get("PACKAGES_UPDATE_GOLDENS") == "1"

DETAIL_CASES = [
    ("atrativa_detail", "atrativa", "https://atrativa.example.invalid/viagem.php?v=101", "fixture"),
    ("niel_detail", "niel", "https://niel.example.invalid/pacote/destino-sintetico", "fixture"),
    (
        "valle_detail",
        "valle",
        "https://valle.example.invalid/home/dezembro-destino-sintetico-p1001",
        "fixture",
    ),
    ("augustus_static_shell", "augustus", "https://augustus.example.invalid/#/pacote/7", "static_html"),
    ("augustus_rendered_detail", "augustus", "https://augustus.example.invalid/#/pacote/7", "rendered_dom"),
    ("injection_atrativa", "atrativa", "https://atrativa.example.invalid/viagem.php?v=101", "fixture"),
]

LISTING_CASES = [
    (
        "atrativa_listing",
        "atrativa",
        "https://atrativa.example.invalid/viagem.php?local=&data=01/12/2026",
        "fixture",
    ),
    ("valle_listing", "valle", "https://valle.example.invalid/home?offset=9&limit=9", "fixture"),
    ("augustus_rendered_listing", "augustus", "https://augustus.example.invalid/#/pacotes", "rendered_dom"),
]


def _check(path: Path, actual) -> None:
    text = dumps(actual)
    if UPDATE:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8", newline="\n")
    assert path.exists(), f"missing golden {path.name}; run with PACKAGES_UPDATE_GOLDENS=1"
    assert json.loads(path.read_text(encoding="utf-8")) == actual
    assert path.read_text(encoding="utf-8") == text


@pytest.mark.parametrize("name,site,url,retrieval", DETAIL_CASES, ids=[case[0] for case in DETAIL_CASES])
def test_detail_golden(name, site, url, retrieval):
    html = (FIXTURES / f"{name}.html").read_text(encoding="utf-8")
    result = parse_package(html, url=url, observed_at=OBSERVED_AT, retrieval=retrieval, site=site)
    assert validate_observation(result) == []
    _check(EXPECTED / f"{name}.json", result)


@pytest.mark.parametrize("name,site,url,retrieval", LISTING_CASES, ids=[case[0] for case in LISTING_CASES])
def test_listing_golden(name, site, url, retrieval):
    html = (FIXTURES / f"{name}.html").read_text(encoding="utf-8")
    result = parse_listing(html, url=url, observed_at=OBSERVED_AT, retrieval=retrieval, site=site)
    for candidate in result:
        assert set(candidate) == {"url", "title", "departureDate", "priceFromMinor"}
    _check(EXPECTED / "listings" / f"{name}.json", result)


def test_every_detail_fixture_has_a_golden_case():
    covered = {case[0] for case in DETAIL_CASES} | {case[0] for case in LISTING_CASES}
    assert {path.stem for path in FIXTURES.glob("*.html")} == covered
