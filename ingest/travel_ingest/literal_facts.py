"""Literal labels only. Unknown formats stay unknown; no inferred dates or prices."""
import re
from datetime import date, datetime

PLACES = {"BRL": 2, "USD": 2, "EUR": 2, "GBP": 2, "CAD": 2, "AUD": 2, "JPY": 0, "KRW": 0, "KWD": 3, "BHD": 3, "OMR": 3}


def literal_facts(text: str, page: int) -> list[dict]:
    facts = []
    for index, line in enumerate(text.splitlines(), 1):
        if len(facts) >= 30:
            break
        source = {"page": page, "line": index, "quote": line[:600]}
        def add(kind, value):
            facts.append({"kind": kind, "value": value, "state": "extracted", "source": source})
        supplier = re.fullmatch(r"(?:supplier|provider|fornecedor|prestador)\s*:\s*(.{1,200})", line.strip(), re.IGNORECASE)
        if supplier:
            add("supplier", supplier[1])
        found = re.fullmatch(r"(?:date|data|departure|arrival|partida|chegada|check[- ]?in|check[- ]?out)\s*:\s*(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})?)?)\s*", line.strip(), re.IGNORECASE)
        if found:
            value = found[1]
            try:
                if len(value) == 10:
                    date.fromisoformat(value)
                    precision = "date"
                else:
                    parsed = datetime.fromisoformat(value.replace("z", "Z"))
                    precision = "offset_datetime" if parsed.tzinfo else "local_datetime_zone_unknown"
                add("date", {"iso": value, "precision": precision})
            except ValueError:
                pass
        amount = re.fullmatch(r"(?:total(?: paid)?|valor total|amount|pre[cç]o)\s*:\s*([A-Z]{3}|R\$)\s*([0-9][0-9.,]{0,40})\s*", line.strip(), re.IGNORECASE)
        if amount:
            currency = "BRL" if amount[1].upper() == "R$" else amount[1].upper()
            digits = PLACES.get(currency)
            if digits is None:
                continue
            raw = amount[2]
            if currency == "BRL" and "," in raw:
                if not re.fullmatch(r"(?:\d{1,3}(?:\.\d{3})*|\d+),\d{2}", raw):
                    continue
                raw = raw.replace(".", "").replace(",", ".")
            if not re.fullmatch(r"\d+" + (rf"(?:\.\d{{{digits}}})?" if digits else ""), raw):
                continue
            whole, _, fraction = raw.partition(".")
            minor = int(whole) * 10 ** digits + int(fraction or "0")
            if minor <= 9000000000000:
                add("money", {"currency": currency, "minorUnits": minor})
    return facts[:30]
