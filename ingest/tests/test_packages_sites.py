"""Happy paths per site and the edge cases called out by the extraction contract."""

from pathlib import Path

import pytest

from travel_ingest.packages import PackageError, detect_site, parse_package, validate_observation

FIXTURES = Path(__file__).parent / "fixtures" / "packages"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"


def parse(
    name_or_html: str,
    site: str,
    *,
    url: str | None = None,
    retrieval: str = "fixture",
    observed_at=OBSERVED_AT,
):
    is_markup = name_or_html.lstrip().startswith("<")
    html = name_or_html if is_markup else (FIXTURES / f"{name_or_html}.html").read_text(encoding="utf-8")
    result = parse_package(
        html,
        url=url or f"https://{site}.example.invalid/pacote",
        observed_at=observed_at,
        retrieval=retrieval,
        site=site,
    )
    assert validate_observation(result) == []
    return result


def evidence_fields(result: dict) -> set[str]:
    return {item["field"] for item in result["evidence"]}


# --- detect_site ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url,site",
    [
        ("https://atrativatur.com.br/viagem.php?v=12", "atrativa"),
        ("https://www.atrativatur.com.br/viagem.php?local=&data=01/12/2026", "atrativa"),
        ("https://nielturismo.suareservaonline.com.br/pacote/x", "niel"),
        ("https://outraagencia.suareservaonline.com.br/pacote/x", "niel"),
        ("https://viajantesdovalle.com.br/home/x-p1", "valle"),
        ("https://www.viajantesdovalle.com.br/home?offset=9&limit=9", "valle"),
        ("https://augustusturismo.com.br/#/pacote/3", "augustus"),
        ("https://WWW.AugustusTurismo.com.br./", "augustus"),
        ("https://example.invalid/pacote", "generic"),
        ("https://suareservaonline.com.br/", "generic"),
        ("https://atrativatur.com.br.example.invalid/", "generic"),
    ],
)
def test_detect_site(url, site):
    assert detect_site(url) == site


def test_explicit_site_wins_over_host_detection():
    result = parse("atrativa_detail", "atrativa", url="https://example.invalid/viagem.php?v=1")
    assert result["source"]["site"] == "atrativa"
    assert result["price"]["amountMinor"] == 123456


# --- atrativa ------------------------------------------------------------------------------


def test_atrativa_detail_two_digit_year_installments_and_partial_breakfast():
    result = parse("atrativa_detail", "atrativa")
    assert result["title"] == "Réveillon em Destino Sintético (UF)"
    assert result["departure"] == {"date": "2026-12-26", "time": "20:00", "yearStated": True}
    assert result["returnArrival"] == {"date": "2026-12-29", "time": "06:30", "yearStated": True}
    assert result["returnDeparture"] == {"date": None, "time": None, "yearStated": False}
    assert result["price"] == {
        "amountMinor": 123456,
        "currency": "BRL",
        "basis": "unknown",
        "qualifier": "exact",
        "installments": {"count": 8, "amountMinor": 15432},
    }
    assert "PRICE_BASIS_UNKNOWN" in result["warnings"]
    assert result["breakfast"] == {"status": "partial", "count": 3}
    assert result["lodging"] == {"name": "Hotel Exemplo Sintético", "nightsIncluded": 3}
    assert result["modal"] == "bus"
    assert "Café da manhã do sábado" in result["excluded"]
    assert "YEAR_NOT_STATED" not in result["warnings"]
    assert result["days"] is None and result["nights"] is None


def test_atrativa_mixed_modal_and_excluded_breakfast():
    html = """<h1>Roteiro Sintético</h1>
    <p>INCLUSO:<br>- Passagem aérea Cidade Sintética A x Cidade Sintética B<br>- Traslado em ônibus executivo</p>
    <p>NÃO INCLUSOS<br>- Café da manhã</p>"""
    result = parse(html, "atrativa")
    assert result["modal"] == "mixed"
    assert result["breakfast"] == {"status": "excluded", "count": None}


def test_atrativa_air_only_and_paragliding_flight_is_not_air():
    air = parse("<h1>X</h1><p>INCLUSO:<br>- Passagem aérea ida e volta</p>", "atrativa")
    assert air["modal"] == "air"
    leisure = parse("<h1>X</h1><p>INCLUSO:<br>- Voo livre de parapente<br>- Hospedagem</p>", "atrativa")
    assert leisure["modal"] == "unknown"


def test_mandatory_fee_payment_and_split_lines():
    html = """<h1>Pacote Sintético</h1>
    <p>Taxa obrigatória de preservação</p><p>R$ 15,00 por pessoa</p><p>Já inclusa no valor do pacote.</p>
    <p>Taxa de turismo obrigatória: R$ 7,50</p>"""
    result = parse(html, "atrativa")
    assert result["mandatoryFees"] == [
        {
            "label": "Taxa obrigatória de preservação",
            "amountMinor": 1500,
            "basis": "per_person",
            "payment": "in_package",
        },
        {
            "label": "Taxa de turismo obrigatória",
            "amountMinor": 750,
            "basis": "unknown",
            "payment": "unknown",
        },
    ]
    assert {"mandatoryFees[0]", "mandatoryFees[1]"} <= evidence_fields(result)


# --- niel ----------------------------------------------------------------------------------


def test_niel_detail_exact_price_fees_and_boarding():
    result = parse("niel_detail", "niel")
    assert result["title"] == "Destino Sintético"
    assert result["destination"] == "Destino Sintético"
    assert (result["days"], result["nights"]) == (4, 3)
    assert result["departure"] == {"date": "2026-12-30", "time": "18:40", "yearStated": True}
    assert result["returnDeparture"] == {"date": "2027-01-03", "time": None, "yearStated": False}
    assert {"YEAR_NOT_STATED", "RETURN_DATE_ROLE_ASSUMED", "RECOMMENDATIONS_IGNORED"} <= set(
        result["warnings"]
    )
    assert result["price"] == {
        "amountMinor": 234567,
        "currency": "BRL",
        "basis": "per_person",
        "qualifier": "exact",
        "installments": {"count": 12, "amountMinor": 19547},
    }
    assert result["mandatoryFees"] == [
        {
            "label": "TAXAS OBRIGATÓRIAS",
            "amountMinor": 12345,
            "basis": "per_person",
            "payment": "paid_locally",
        }
    ]
    assert result["boardingCities"] == ["Cidade Sintética A", "Cidade Sintética B"]
    assert result["breakfast"] == {"status": "included", "count": None}
    assert result["lodging"]["nightsIncluded"] == 1
    assert result["modal"] == "bus"


def test_niel_from_price_only():
    html = """<title>Destino Sintético - NIEL TURISMO</title>
    <h1>Destino Sintético</h1><p>Pacote Turísticos 3 dias e 2 noites</p>
    <div><span>A partir de</span> <strong>R$1.234,56</strong></div><div>/por pessoa</div>"""
    result = parse(html, "niel")
    assert result["price"]["amountMinor"] == 123456
    assert result["price"]["qualifier"] == "from"
    assert result["price"]["basis"] == "per_person"
    assert result["price"]["installments"] is None
    assert "price.qualifier" in evidence_fields(result)


def test_niel_boarding_date_mismatch_keeps_saida_without_year():
    html = """<h1>Destino Sintético</h1><p>Saída 30 de dez &gt; qua Volta 03 de jan &gt; dom</p>
    <ul><li><b>Embarque 1º</b> <span>Cidade Sintética A</span> <span>Ponto</span> <span>23/12/2026 às 18h40</span></li></ul>"""
    result = parse(html, "niel")
    assert result["departure"] == {"date": "2026-12-30", "time": None, "yearStated": False}
    assert result["returnDeparture"]["date"] == "2027-01-03"
    assert "BOARDING_DATE_MISMATCH" in result["warnings"]


def test_niel_ambiguous_boarding_city_is_not_guessed():
    html = (
        """<h1>D</h1><ul><li>Embarque 1º Cidade Sintética A Ponto Sintético 30/12/2026 às 18h40</li></ul>"""
    )
    result = parse(html, "niel")
    assert result["boardingCities"] == []
    assert "BOARDING_CITY_AMBIGUOUS" in result["warnings"]
    assert result["departure"] == {"date": "2026-12-30", "time": "18:40", "yearStated": True}


# --- valle ---------------------------------------------------------------------------------


def test_valle_detail_without_year():
    result = parse("valle_detail", "valle")
    assert result["departure"] == {"date": "2026-12-24", "time": "22:00", "yearStated": False}
    assert result["returnDeparture"] == {"date": "2026-12-27", "time": "17:00", "yearStated": False}
    assert result["returnArrival"] == {"date": "2026-12-28", "time": "03:00", "yearStated": False}
    assert (result["days"], result["nights"]) == (3, 2)
    assert result["destination"] == "Destino Sintético (UF)"
    assert result["price"]["amountMinor"] == 34567
    assert result["price"]["basis"] == "unknown"
    assert result["price"]["qualifier"] == "exact"
    assert {"PRICE_BASIS_UNKNOWN", "LODGING_MAY_CHANGE", "YEAR_NOT_STATED"} <= set(result["warnings"])
    assert result["lodging"] == {"name": "Hotel Exemplo Sintético", "nightsIncluded": 2}
    assert result["breakfast"] == {"status": "included", "count": 2}
    assert result["boardingCities"] == [
        "Cidade Sintética A (UF)",
        "Cidade Sintética B (UF)",
        "Cidade Sintética C (UF)",
    ]
    assert result["modal"] == "bus"


def test_missing_year_rolls_forward_from_observed_at_not_the_clock():
    result = parse("valle_detail", "valle", observed_at="2026-12-26T09:00:00Z")
    assert result["departure"]["date"] == "2027-12-24"
    assert result["returnDeparture"]["date"] == "2027-12-27"
    assert result["returnArrival"]["date"] == "2027-12-28"
    same_day = parse("valle_detail", "valle", observed_at="2026-12-24T23:59:00-03:00")
    assert same_day["departure"]["date"] == "2026-12-24"


def test_missing_year_on_february_29_picks_next_leap_year():
    html = '<script type="application/ld+json">{"@type":"Product","name":"Bissexto","description":"Quando: 29/02 a 02/03"}</script>'
    result = parse(html, "valle")
    assert result["departure"] == {"date": "2028-02-29", "time": None, "yearStated": False}
    assert result["returnDeparture"]["date"] == "2028-03-02"


def test_valle_without_jsonld_falls_back_to_visible_text():
    html = "<h1>Pacote Sintético</h1><p>Quando: 05/01 a 07/01</p><p>Valor: R$ 99,90 por pessoa</p>"
    result = parse(html, "valle")
    assert "JSONLD_PRODUCT_MISSING" in result["warnings"]
    assert result["price"]["amountMinor"] == 9990
    assert result["price"]["basis"] == "per_person"
    assert result["departure"]["date"] == "2027-01-05"


def test_valle_offer_price_used_when_description_has_no_value():
    html = (
        '<script type="application/ld+json">{"@type":"Product","name":"Pacote Sintético",'
        '"description":"Local: Destino Sintético","offers":{"price":"210.50","priceCurrency":"BRL"}}</script>'
    )
    result = parse(html, "valle")
    assert result["price"]["amountMinor"] == 21050
    assert result["price"]["qualifier"] == "exact"
    assert result["price"]["basis"] == "unknown"


# --- augustus ------------------------------------------------------------------------------


def test_augustus_rendered_detail():
    result = parse("augustus_rendered_detail", "augustus", retrieval="rendered_dom")
    assert result["title"] == "Pacote Destino Sintético"
    assert result["destination"] == "Destino Sintético"
    assert (result["days"], result["nights"]) == (5, 4)
    assert result["departure"] == {"date": "2027-01-15", "time": None, "yearStated": True}
    assert result["returnArrival"] == {"date": "2027-01-19", "time": None, "yearStated": True}
    assert result["price"] == {
        "amountMinor": 45678,
        "currency": "BRL",
        "basis": "per_person",
        "qualifier": "exact",
        "installments": {"count": 12, "amountMinor": 3807},
    }
    assert result["breakfast"]["status"] == "included"
    assert result["lodging"]["name"] == "Hotel Exemplo Sintético"
    assert result["modal"] == "bus"
    assert {"RETURN_DATE_MAY_BE_COMPUTED", "YEAR_MAY_BE_SITE_ADJUSTED"} <= set(result["warnings"])


# --- generic -------------------------------------------------------------------------------


def test_generic_site_reads_only_explicit_labels():
    html = (
        "<h1>Excursão Sintética 2 dias e 1 noite</h1><p>Saída: 10/01/2027 às 05:00</p><p>Preço: R$ 300,00</p>"
    )
    result = parse_package(
        html, url="https://example.invalid/x", observed_at=OBSERVED_AT, retrieval="fixture"
    )
    assert result["source"]["site"] == "generic"
    assert "GENERIC_SITE_PARSER" in result["warnings"]
    assert result["departure"] == {"date": "2027-01-10", "time": "05:00", "yearStated": True}
    assert result["price"]["amountMinor"] == 30000
    assert (result["days"], result["nights"]) == (2, 1)


# --- evidence ------------------------------------------------------------------------------


def _non_null_paths(result: dict) -> set[str]:
    paths = set()
    for key in ("title", "destination", "days", "nights"):
        if result[key] is not None:
            paths.add(key)
    if result["modal"] != "unknown":
        paths.add("modal")
    for key in ("departure", "returnDeparture", "returnArrival"):
        for part in ("date", "time"):
            if result[key][part] is not None:
                paths.add(f"{key}.{part}")
    for part in ("name", "nightsIncluded"):
        if result["lodging"][part] is not None:
            paths.add(f"lodging.{part}")
    if result["breakfast"]["status"] != "unknown":
        paths.add("breakfast.status")
    if result["breakfast"]["count"] is not None:
        paths.add("breakfast.count")
    price = result["price"]
    if price["amountMinor"] is not None:
        paths.add("price.amountMinor")
    if price["basis"] != "unknown":
        paths.add("price.basis")
    if price["qualifier"] != "unknown":
        paths.add("price.qualifier")
    if price["installments"] is not None:
        paths.add("price.installments")
    for index in range(len(result["mandatoryFees"])):
        paths.add(f"mandatoryFees[{index}]")
    for key in ("included", "excluded", "boardingCities"):
        if result[key]:
            paths.add(key)
    return paths


@pytest.mark.parametrize(
    "name,site,retrieval",
    [
        ("atrativa_detail", "atrativa", "fixture"),
        ("niel_detail", "niel", "fixture"),
        ("valle_detail", "valle", "fixture"),
        ("augustus_rendered_detail", "augustus", "rendered_dom"),
    ],
)
def test_every_non_null_field_has_a_literal_quote(name, site, retrieval):
    result = parse(name, site, retrieval=retrieval)
    assert _non_null_paths(result) <= evidence_fields(result)
    for item in result["evidence"]:
        assert 1 <= len(item["quote"]) <= 240
        assert item["quote"] == " ".join(item["quote"].split())


def test_errors_are_stable_codes():
    with pytest.raises(PackageError) as caught:
        parse_package(
            "<p>x</p>", url="http://atrativa.example.invalid/", observed_at=OBSERVED_AT, retrieval="fixture"
        )
    assert caught.value.code == "URL_NOT_HTTPS"
    assert str(caught.value) == "URL_NOT_HTTPS"
