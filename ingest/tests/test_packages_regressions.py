"""Regression tests for review findings D7 to D14 (D4 to D6 live in test_packages_fetch.py)."""

import io
import json

import pytest

from travel_ingest.packages import parse_listing, parse_package, validate_observation
from travel_ingest.packages.cli import main
from travel_ingest.packages.common import first_money, has_contact, money_minor, safe_prefix

OBSERVED_AT = "2026-11-04T12:00:00-03:00"
NBSP = chr(0xA0)


def parse(html: str, site: str, observed_at: str = OBSERVED_AT) -> dict:
    result = parse_package(
        html,
        url=f"https://{site}.example.invalid/pacote",
        observed_at=observed_at,
        retrieval="fixture",
        site=site,
    )
    assert validate_observation(result) == []
    return result


def quotes(result: dict) -> str:
    return " | ".join(item["quote"] for item in result["evidence"])


# --- D7: listing size --------------------------------------------------------------------------


def test_listing_is_truncated_to_60_in_document_order():
    cards = "".join(
        f'<div class="viagem-card"><a href="viagem.php?v={n}"><h3>Roteiro Sintético {n}</h3></a><p>R$ {n},00</p></div>'
        for n in range(1, 62)
    )
    result = parse_listing(
        f"<div>{cards}</div>",
        url="https://atrativa.example.invalid/viagem.php?local=",
        observed_at=OBSERVED_AT,
        retrieval="fixture",
        site="atrativa",
    )
    assert len(result) == 60
    assert [c["url"] for c in result] == [
        f"https://atrativa.example.invalid/viagem.php?v={n}" for n in range(1, 61)
    ]
    assert all(set(c) == {"url", "title", "departureDate", "priceFromMinor"} for c in result)


# --- D8: contact filter --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "Reservas: (00) 9 0000 0000",
        "ligue 90000 0000",
        "fixo 3000 0000",
        "ligue 90000" + NBSP + "0000",
        "SAC 0800 000 0000",
        "SAC 0800-000-0000",
        "central 0300 000 0000",
        "capitais 4004 0000",
        "+55 00 00000-0000",
        "(00) 00000-0000",
        "links em linktr.ee/x",
        "encurtado bit.ly/x",
        "site agencia.tur.br",
    ],
)
def test_contact_variants_are_detected(text):
    assert has_contact(text)


@pytest.mark.parametrize(
    "text",
    [
        "Saída: sexta-feira, 23/12/2026 às 18h40",
        "Embarque 1º Cidade Sintética A 30/12/2026 às 19:30",
        "Quando: 24/12 a 27/12",
        "Valor à vista: R$ 1.299,00 ou 12x de R$ 108,25",
        "R$ 12.345.678,90",
        "R$ 1 299,00",
        "Pacote Turísticos 4 dias e 3 noites",
        "Hospedagem (03 dias / 02 noites)",
        "Consulte as condições.Volta garantida",
    ],
)
def test_dates_times_and_prices_are_not_contacts(text):
    assert not has_contact(text)


def test_contact_items_dropped_while_dates_and_prices_survive():
    html = (
        "<h1>Pacote Sintético</h1>"
        "<p>Saída: sexta-feira, 23/12/2026 às 18h40</p>"
        "<p>Valor à vista: R$ 12.345.678,90</p>"
        "<p>INCLUSO:<br>- Transporte em ônibus<br>- Plantão (00) 9 0000 0000<br>- Atendimento 0800-000-0000"
        "<br>- Roteiro em linktr.ee/x<br>- Seguro viagem</p>"
    )
    result = parse(html, "atrativa")
    assert result["departure"] == {"date": "2026-12-23", "time": "18:40", "yearStated": True}
    assert result["price"]["amountMinor"] == 1234567890
    assert result["included"] == ["Transporte em ônibus", "Seguro viagem"]
    assert "CONTACT_DATA_DROPPED" in result["warnings"]
    for leaked in ("0000 0000", "0800", "linktr"):
        assert leaked not in json.dumps(result, ensure_ascii=False)


# --- D9: phone on the 240-character boundary --------------------------------------------------


def test_phone_straddling_the_quote_limit_never_leaks():
    prefix = "Valor à vista: R$ 1.234,56 "
    phone = "+55 00 00000-0000"
    line = prefix + "x" * (232 - len(prefix) - 1) + " " + phone
    assert line.index(phone) == 232
    assert "+55" in line[:240] and phone not in line[:240]  # the old window cut the phone in half
    result = parse(f"<h1>Pacote Sintético</h1><p>{line}</p>", "atrativa")
    assert result["price"]["amountMinor"] == 123456
    text = quotes(result)
    assert "+55" not in text and "00000" not in text
    assert safe_prefix(line) == prefix + "x" * (232 - len(prefix) - 1)


# --- D10: recommendations ------------------------------------------------------------------------

MAIN = (
    "<main><h1>Destino Sintético</h1><p>Pacote Turísticos 4 dias e 3 noites</p>"
    "<p>Saída 30 de dez &gt; qua Volta 03 de jan &gt; dom</p><p>A partir de R$2.345,67 /por pessoa</p></main>"
)
REC_BODY = (
    "<p>Pacote Turísticos 6 dias e 5 noites</p><p>Saída 10 de jan &gt; sáb Volta 15 de jan &gt; qui</p>"
    "<p>A partir de R$9.876,54 /por pessoa</p>"
)


@pytest.mark.parametrize(
    "recommendations",
    [
        f'<section class="lista"><h3>Atividades recomendadas (2)</h3>{REC_BODY}</section>',
        f'<section class="lista"><h3>Atividades <strong>recomendadas</strong></h3>{REC_BODY}</section>',
        f'<section class="lista"><h3>Atividades recomendadas para você</h3>{REC_BODY}</section>',
        f'<div class="box"><span>Atividades</span> <span>recomendadas</span></div><div class="cards">{REC_BODY}</div>',
    ],
    ids=["count", "split-tags", "trailing-words", "split-spans"],
)
def test_recommendation_heading_variants_are_removed(recommendations):
    result = parse(f'<div class="page">{recommendations}{MAIN}</div>', "niel")
    assert "RECOMMENDATIONS_IGNORED" in result["warnings"]
    assert "RECOMMENDATIONS_NOT_ISOLATED" not in result["warnings"]
    assert result["price"]["amountMinor"] == 234567
    assert (result["days"], result["nights"]) == (4, 3)
    assert result["departure"]["date"] == "2026-12-30"
    assert "987654" not in json.dumps(result)


def test_recommendations_that_cannot_be_isolated_fail_closed():
    leaked = (
        "<p>Veja também as Atividades recomendadas: Pacote Turísticos 6 dias e 5 noites, "
        "Saída 10 de jan &gt; sáb, A partir de R$9.876,54 /por pessoa</p>"
    )
    result = parse(f'<div class="page">{leaked}{MAIN}</div>', "niel")
    assert "RECOMMENDATIONS_NOT_ISOLATED" in result["warnings"]
    for key in ("departure", "returnDeparture", "returnArrival"):
        assert result[key] == {"date": None, "time": None, "yearStated": False}
    assert result["days"] is None and result["nights"] is None
    assert result["price"]["amountMinor"] is None and result["price"]["installments"] is None
    assert result["mandatoryFees"] == []
    fields = {item["field"].split(".")[0] for item in result["evidence"]}
    assert not fields & {"departure", "returnDeparture", "days", "nights", "price"}
    assert result["title"] == "Destino Sintético"


# --- D11: malformed amounts ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "text,minor",
    [
        ("R$ 1.299", 129900),
        ("R$ 0,99", 99),
        ("R$ 12.345.678,90", 1234567890),
        ("R$" + NBSP + "1.299,00", 129900),
        ("R$ 1 299,00", 129900),
        ("R$ 1" + NBSP + "299,00", 129900),
        ("Valor: R$ 1.299,00.", 129900),
        ("R$ 1.299,5", None),
        ("R$ 12.34", None),
        ("R$ 1 29,00", None),
        ("R$ 1.29,00", None),
        ("R$ 100 98765 4321", None),
    ],
)
def test_money_is_exact_or_absent(text, minor):
    match = first_money(text)
    assert (money_minor(match) if match else None) == minor


def test_malformed_amount_leaves_the_price_unknown():
    result = parse("<h1>Pacote</h1><p>Valor à vista: R$ 1.299,5</p>", "atrativa")
    assert result["price"]["amountMinor"] is None


# --- D12: installments written as "parcelas" or "vezes" ------------------------------------------


@pytest.mark.parametrize("word", ["parcelas", "vezes", "x"])
def test_installment_words(word):
    html = f"<h1>Pacote</h1><p>Valor: 10 {word} de R$ 129,90 ou R$ 1.299,00 à vista</p>"
    result = parse_package(
        html, url="https://example.invalid/p", observed_at=OBSERVED_AT, retrieval="fixture"
    )
    assert result["price"]["amountMinor"] == 129900
    assert result["price"]["qualifier"] == "exact"
    assert result["price"]["installments"] == {"count": 10, "amountMinor": 12990}


# --- D13: absurd JSON-LD numbers ----------------------------------------------------------------


@pytest.mark.parametrize("raw", ['"1E+1000000"', "1E+1000000", '"NaN"', '"-5"', '"12.345"'])
def test_absurd_offer_price_is_null_with_warning(raw):
    html = (
        '<script type="application/ld+json">{"@type":"Product","name":"Pacote Sintético",'
        '"description":"Local: Destino Sintético","offers":{"price":'
        + raw
        + ',"priceCurrency":"BRL"}}</script>'
    )
    result = parse(html, "valle")
    assert result["price"]["amountMinor"] is None
    assert "PRICE_INVALID" in result["warnings"]


def test_absurd_offer_price_does_not_crash_the_cli(tmp_path):
    page = tmp_path / "pagina.html"
    page.write_text(
        '<script type="application/ld+json">{"@type":"Product","name":"Pacote",'
        '"offers":{"price":"1E+1000000","priceCurrency":"BRL"}}</script>',
        encoding="utf-8",
    )
    out, err = io.StringIO(), io.StringIO()
    code = main(
        [
            "parse",
            "--html-file",
            str(page),
            "--url",
            "https://valle.example.invalid/p",
            "--observed-at",
            OBSERVED_AT,
            "--site",
            "valle",
        ],
        stdout=out,
        stderr=err,
    )
    assert code == 0 and err.getvalue() == ""
    result = json.loads(out.getvalue())
    assert result["price"]["amountMinor"] is None
    assert "PRICE_INVALID" in result["warnings"]


# --- D14: return anchored on the departure ------------------------------------------------------


def test_return_without_year_follows_a_past_departure():
    html = "<h1>Pacote</h1><p>Saída: 10/01/26 às 08:00</p><p>Retorno: 12/01</p>"
    result = parse_package(
        html, url="https://example.invalid/p", observed_at=OBSERVED_AT, retrieval="fixture"
    )
    assert result["departure"] == {"date": "2026-01-10", "time": "08:00", "yearStated": True}
    assert result["returnDeparture"] == {"date": "2026-01-12", "time": None, "yearStated": False}


def test_valle_return_and_arrival_follow_the_departure():
    description = (
        "Saída: Sábado 10/01/26 as 22h\\nRetorno: Segunda 12/01 as 17h\\nChegada: Terça 13/01 as 03h"
    )
    html = (
        '<script type="application/ld+json">{"@type":"Product","name":"Pacote","description":"'
        + description
        + '"}</script>'
    )
    result = parse(html, "valle")
    assert result["departure"]["date"] == "2026-01-10"
    assert result["returnDeparture"]["date"] == "2026-01-12"
    assert result["returnArrival"]["date"] == "2026-01-13"
