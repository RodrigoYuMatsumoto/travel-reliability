from travel_ingest.extract import extract


def test_literals_remain_unconfirmed_and_ambiguous_inputs_unknown():
    text = "\n".join([
        "Supplier: Synthetic Provider", "Date: 2030-03-01",
        "Departure: 2030-03-01T08:30", "Arrival: 2030-03-01T10:00-03:00",
        "Total: BRL 1.234,56", "Amount: USD 12.34", "Total: JPY 0", "Total: KWD 1.234",
        "Date: 2030-02-30", "Date: 03/04/2030", "Total: USD 1,234", "Total: XXX 5.00", "Total: BRL 1.234",
    ])
    facts = extract(text.encode(), "text/plain")["facts"]
    assert [fact["value"] for fact in facts] == [
        "Synthetic Provider", {"iso": "2030-03-01", "precision": "date"},
        {"iso": "2030-03-01T08:30", "precision": "local_datetime_zone_unknown"},
        {"iso": "2030-03-01T10:00-03:00", "precision": "offset_datetime"},
        {"currency": "BRL", "minorUnits": 123456}, {"currency": "USD", "minorUnits": 1234},
        {"currency": "JPY", "minorUnits": 0}, {"currency": "KWD", "minorUnits": 1234},
    ]
    assert all(f["state"] == "extracted" and text.splitlines()[f["source"]["line"] - 1] == f["source"]["quote"] for f in facts)
    assert len(extract(("Total: USD 1.00\n" * 40).encode(), "text/plain")["facts"]) == 30
