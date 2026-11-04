"""Adversarial inputs: injection, contacts, recommendations, static shells, limits, determinism."""

import json
import re
from pathlib import Path

import pytest

from travel_ingest.packages import PackageError, detect_site, parse_listing, parse_package
from travel_ingest.packages.cli import dumps

FIXTURES = Path(__file__).parent / "fixtures" / "packages"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"
ATRATIVA_URL = "https://atrativa.example.invalid/viagem.php?v=101"


def fixture(name: str) -> str:
    return (FIXTURES / f"{name}.html").read_text(encoding="utf-8")


def parse(html: str, site: str, retrieval: str = "fixture", url: str | None = None) -> dict:
    return parse_package(
        html,
        url=url or f"https://{site}.example.invalid/pacote",
        observed_at=OBSERVED_AT,
        retrieval=retrieval,
        site=site,
    )


def payload(result: dict) -> str:
    """Everything except the source block, which legitimately carries the page URL."""
    return json.dumps({k: v for k, v in result.items() if k != "source"}, ensure_ascii=False)


ALL_DETAILS = [
    ("atrativa_detail", "atrativa", "fixture"),
    ("niel_detail", "niel", "fixture"),
    ("valle_detail", "valle", "fixture"),
    ("augustus_static_shell", "augustus", "static_html"),
    ("augustus_rendered_detail", "augustus", "rendered_dom"),
    ("injection_atrativa", "atrativa", "fixture"),
]


# --- prompt injection ----------------------------------------------------------------------


def test_injection_changes_nothing_but_warnings():
    clean = parse(fixture("atrativa_detail"), "atrativa", url=ATRATIVA_URL)
    attacked = parse(fixture("injection_atrativa"), "atrativa", url=ATRATIVA_URL)
    for key in clean:
        if key not in ("source", "warnings"):
            assert attacked[key] == clean[key], key
    assert {"UNTRUSTED_INSTRUCTION_DETECTED", "HIDDEN_CONTENT_REMOVED"} <= set(attacked["warnings"])
    assert set(clean["warnings"]) <= set(attacked["warnings"])
    text = payload(attacked).lower()
    assert "ignore" not in text and "gratuito" not in text and "system prompt" not in text
    assert attacked["price"]["amountMinor"] == 123456


def test_hidden_and_commented_values_are_never_read():
    html = (
        "<h1>Pacote Sintético</h1><div hidden>Valor à vista: R$ 1,00</div>"
        "<!-- Saída: sábado, 01/01/26 às 00:00 -->"
        '<p style="opacity:0">Acomodação: Hotel Oculto</p>'
        "<p>Valor à vista: R$ 500,00</p>"
    )
    result = parse(html, "atrativa")
    assert result["price"]["amountMinor"] == 50000
    assert result["departure"]["date"] is None
    assert result["lodging"]["name"] is None
    assert "HIDDEN_CONTENT_REMOVED" in result["warnings"]


def test_scripts_are_never_read():
    html = (
        "<h1>Pacote Sintético</h1><script>document.write('Valor à vista: R$ 9.999,99')</script>"
        "<p>Valor à vista: R$ 10,00</p>"
    )
    result = parse(html, "atrativa")
    assert result["price"]["amountMinor"] == 1000
    assert "999999" not in json.dumps(result)


# --- contacts and privacy ------------------------------------------------------------------

CONTACT_PATTERNS = [
    r"00000-0000",
    r"\+55",
    r"whats\s*app",
    r"wa\.me",
    r"@",
    r"https?://",
    r"Rua Sint",
    r"example\.invalid",
    r"\d{3}\.\d{3}\.\d{3}-\d{2}",
]


@pytest.mark.parametrize("name,site,retrieval", ALL_DETAILS, ids=[case[0] for case in ALL_DETAILS])
def test_no_contact_or_address_leaks_into_any_field(name, site, retrieval):
    text = payload(parse(fixture(name), site, retrieval))
    for pattern in CONTACT_PATTERNS:
        assert not re.search(pattern, text, re.I), pattern


def test_items_with_contacts_are_dropped_whole():
    result = parse(fixture("atrativa_detail"), "atrativa")
    assert not any("Guia acompanhante" in item for item in result["included"])
    assert "CONTACT_DATA_DROPPED" in result["warnings"]


def test_lodging_or_title_with_contact_becomes_null():
    html = "<h1>Ligue (00) 00000-0000</h1><p>Acomodação: Hotel Sintético reservas@example.invalid</p>"
    result = parse(html, "atrativa")
    assert result["title"] is None
    assert result["lodging"]["name"] is None
    assert "CONTACT_DATA_DROPPED" in result["warnings"]


# Built at runtime so the source never holds a CPF-shaped literal.
SYNTHETIC_CPF = ".".join(["000"] * 3) + "-00"


def test_cpf_and_address_are_dropped_from_lists():
    html = (
        "<h1>Pacote</h1><p>INCLUSO:<br>- Transporte em ônibus<br>- Titular CPF " + SYNTHETIC_CPF + "<br>"
        "- Embarque na Av. Sintética, 100<br>- Seguro viagem</p>"
    )
    result = parse(html, "atrativa")
    assert result["included"] == ["Transporte em ônibus", "Seguro viagem"]


# --- recommendations and static shells -----------------------------------------------------


def test_niel_recommendations_do_not_leak():
    result = parse(fixture("niel_detail"), "niel")
    text = json.dumps(result, ensure_ascii=False)
    for forbidden in (
        "987654",
        "765432",
        "2027-01-10",
        "2027-01-15",
        "2027-02-20",
        "Recomendad",
        "Outro Destino",
        "Terceiro",
    ):
        assert forbidden not in text, forbidden
    assert result["days"] == 4 and result["nights"] == 3
    assert "RECOMMENDATIONS_IGNORED" in result["warnings"]


def test_recommendations_after_main_content_and_without_section_wrapper():
    html = """<div class="page"><h1>Destino Sintético</h1><p>A partir de R$100,00 /por pessoa</p>
    <div class="box"><h3>Atividades recomendadas</h3></div>
    <div class="cards"><p>A partir de R$999,00 /por pessoa</p><p>Saída 01 de mar &gt; dom</p></div></div>"""
    result = parse(html, "niel")
    assert result["price"]["amountMinor"] == 10000
    assert result["departure"]["date"] is None
    assert "99900" not in json.dumps(result)


def _all_null(result: dict) -> None:
    assert result["title"] is None and result["destination"] is None
    assert result["modal"] == "unknown"
    for key in ("departure", "returnDeparture", "returnArrival"):
        assert result[key] == {"date": None, "time": None, "yearStated": False}
    assert result["days"] is None and result["nights"] is None
    assert result["lodging"] == {"name": None, "nightsIncluded": None}
    assert result["breakfast"] == {"status": "unknown", "count": None}
    assert result["price"]["amountMinor"] is None and result["price"]["installments"] is None
    assert result["mandatoryFees"] == [] and result["included"] == [] and result["excluded"] == []
    assert result["boardingCities"] == [] and result["evidence"] == []


@pytest.mark.parametrize("retrieval", ["static_html", "fixture", "rendered_dom"])
def test_augustus_static_shell_is_not_evidence(retrieval):
    result = parse(fixture("augustus_static_shell"), "augustus", retrieval)
    _all_null(result)
    assert {"STATIC_SHELL_NOT_EVIDENCE", "RENDER_REQUIRED"} <= set(result["warnings"])
    text = json.dumps(result, ensure_ascii=False)
    for forbidden in ("99999", "11111", "8333", "Demonstra", "Demo", "2027-01-15"):
        assert forbidden not in text


def test_augustus_rendered_markup_fetched_statically_is_still_not_evidence():
    result = parse(fixture("augustus_rendered_detail"), "augustus", "static_html")
    _all_null(result)
    assert "RENDER_REQUIRED" in result["warnings"]


def test_augustus_static_listing_requires_render():
    with pytest.raises(PackageError) as caught:
        parse_listing(
            fixture("augustus_static_shell"),
            url="https://augustus.example.invalid/#/pacotes",
            observed_at=OBSERVED_AT,
            retrieval="static_html",
            site="augustus",
        )
    assert caught.value.code == "RENDER_REQUIRED"


# --- Instagram, limits, invalid input ------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    ["https://www.instagram.com/agencia.sintetica/", "https://instagram.com/p/xyz", "https://instagr.am/p/1"],
)
def test_instagram_is_refused_even_with_explicit_site(url):
    with pytest.raises(PackageError) as caught:
        detect_site(url)
    assert caught.value.code == "INSTAGRAM_NOT_SUPPORTED"
    with pytest.raises(PackageError) as caught:
        parse_package("<p>x</p>", url=url, observed_at=OBSERVED_AT, retrieval="fixture", site="atrativa")
    assert caught.value.code == "INSTAGRAM_NOT_SUPPORTED"


def test_html_size_limit():
    big = "<p>" + "a" * (5 * 1024 * 1024) + "</p>"
    with pytest.raises(PackageError) as caught:
        parse(big, "atrativa")
    assert caught.value.code == "HTML_TOO_LARGE"
    multibyte = "é" * (3 * 1024 * 1024)  # under 5 Mi characters, over 5 MiB in UTF-8
    with pytest.raises(PackageError) as caught:
        parse(multibyte, "atrativa")
    assert caught.value.code == "HTML_TOO_LARGE"


@pytest.mark.parametrize(
    "kwargs,code",
    [
        ({"url": "http://atrativa.example.invalid/"}, "URL_NOT_HTTPS"),
        ({"url": "https://atrativa.example.invalid/ espaço"}, "URL_INVALID"),
        ({"url": "https://user:pw@example.invalid/"}, "URL_INVALID"),
        ({"observed_at": "2026-11-04"}, "OBSERVED_AT_INVALID"),
        ({"observed_at": "2026-11-04T12:00:00"}, "OBSERVED_AT_INVALID"),
        ({"observed_at": "2026-02-30T12:00:00Z"}, "OBSERVED_AT_INVALID"),
        ({"retrieval": "browser"}, "RETRIEVAL_INVALID"),
        ({"site": "booking"}, "SITE_INVALID"),
    ],
)
def test_invalid_inputs_raise_stable_codes(kwargs, code):
    arguments = {"url": ATRATIVA_URL, "observed_at": OBSERVED_AT, "retrieval": "fixture", "site": "atrativa"}
    arguments.update(kwargs)
    secret = "CONTEUDO-SECRETO-DA-PAGINA"
    with pytest.raises(PackageError) as caught:
        parse_package(f"<p>{secret}</p>", **arguments)
    assert caught.value.code == code
    assert secret not in str(caught.value)


def test_invalid_jsonld_is_reported_not_executed():
    html = '<script type="application/ld+json">{"@type": "Product", "name": </script><h1>Pacote</h1>'
    result = parse(html, "valle")
    assert "JSONLD_INVALID" in result["warnings"]
    deep = '<script type="application/ld+json">' + "[" * 5000 + "]" * 5000 + "</script>"
    assert "JSONLD_INVALID" in parse(deep, "valle")["warnings"]


def test_impossible_dates_are_dropped_not_invented():
    html = "<h1>X</h1><p>Saída: sexta, 31/02/27 às 25:99</p>"
    result = parse(html, "atrativa")
    assert result["departure"] == {"date": None, "time": None, "yearStated": False}
    assert "INVALID_DATE_IGNORED" in result["warnings"]


# --- determinism ---------------------------------------------------------------------------


@pytest.mark.parametrize("name,site,retrieval", ALL_DETAILS, ids=[case[0] for case in ALL_DETAILS])
def test_same_input_same_bytes(name, site, retrieval):
    html = fixture(name)
    first = dumps(parse(html, site, retrieval))
    second = dumps(parse(html, site, retrieval))
    assert first == second


def test_content_hash_is_sha256_of_utf8_input():
    import hashlib

    html = fixture("valle_detail")
    result = parse(html, "valle")
    assert result["source"]["contentSha256"] == hashlib.sha256(html.encode("utf-8")).hexdigest()
