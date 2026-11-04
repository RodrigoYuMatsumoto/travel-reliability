"""Listing pages produce discovery candidates only; unknown values stay None."""

import json
from pathlib import Path

import pytest

from travel_ingest.packages import PackageError, parse_listing

FIXTURES = Path(__file__).parent / "fixtures" / "packages"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"


def listing(name: str, site: str, url: str, retrieval: str = "fixture") -> list[dict]:
    html = (FIXTURES / f"{name}.html").read_text(encoding="utf-8")
    return parse_listing(html, url=url, observed_at=OBSERVED_AT, retrieval=retrieval, site=site)


def test_atrativa_listing_candidates():
    result = listing(
        "atrativa_listing", "atrativa", "https://atrativa.example.invalid/viagem.php?local=&data=01/12/2026"
    )
    assert [c["url"] for c in result] == [
        "https://atrativa.example.invalid/viagem.php?v=101",
        "https://atrativa.example.invalid/viagem.php?v=102",
        "https://atrativa.example.invalid/viagem.php?v=103",
    ]
    assert result[0] == {
        "url": "https://atrativa.example.invalid/viagem.php?v=101",
        "title": "Réveillon em Destino Sintético (UF)",
        "departureDate": "2026-12-26",
        "priceFromMinor": 123456,
    }
    assert result[2]["departureDate"] is None and result[2]["priceFromMinor"] is None
    assert "00000" not in json.dumps(result)


def test_valle_listing_skips_whatsapp_and_foreign_hosts_and_keeps_unknown_years_null():
    result = listing("valle_listing", "valle", "https://valle.example.invalid/home?offset=9&limit=9")
    urls = [c["url"] for c in result]
    assert urls == [
        "https://valle.example.invalid/home/dezembro-destino-sintetico-p1001",
        "https://valle.example.invalid/home/janeiro-outro-destino-sintetico-p1002",
        "https://valle.example.invalid/home/carnaval-terceiro-destino-p1003",
    ]
    assert [c["departureDate"] for c in result] == [None, None, "2027-02-13"]
    assert [c["priceFromMinor"] for c in result] == [34567, 45678, 56789]
    text = json.dumps(result)
    assert "wa.me" not in text and "outra-loja" not in text and '"priceFromMinor": 100' not in text


def test_augustus_rendered_listing_ignores_demo_script_and_unlinked_cards():
    result = listing(
        "augustus_rendered_listing", "augustus", "https://augustus.example.invalid/#/pacotes", "rendered_dom"
    )
    assert result == [
        {
            "url": "https://augustus.example.invalid/#/pacote/7",
            "title": "Pacote Destino Sintético",
            "departureDate": "2027-01-15",
            "priceFromMinor": 45678,
        },
        {
            "url": "https://augustus.example.invalid/#/pacote/8",
            "title": "Pacote Outro Destino Sintético",
            "departureDate": "2027-02-20",
            "priceFromMinor": 56789,
        },
    ]


@pytest.mark.parametrize("site", ["niel", "generic"])
def test_listing_not_supported_sites(site):
    with pytest.raises(PackageError) as caught:
        parse_listing(
            "<a href='/x'>x</a>",
            url="https://x.example.invalid/",
            observed_at=OBSERVED_AT,
            retrieval="fixture",
            site=site,
        )
    assert caught.value.code == "LISTING_NOT_SUPPORTED"


def test_listing_title_with_contact_is_null():
    html = '<div><a href="viagem.php?v=5"><h3>Ligue (00) 00000-0000</h3></a><p>R$ 10,00</p></div>'
    result = parse_listing(
        html,
        url="https://atrativa.example.invalid/viagem.php?local=",
        observed_at=OBSERVED_AT,
        retrieval="fixture",
        site="atrativa",
    )
    assert result == [
        {
            "url": "https://atrativa.example.invalid/viagem.php?v=5",
            "title": None,
            "departureDate": None,
            "priceFromMinor": 1000,
        }
    ]
