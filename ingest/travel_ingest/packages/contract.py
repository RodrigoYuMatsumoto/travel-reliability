"""Python mirror of ``schema/src/package-observation.ts`` used as a self-check.

``parse_package`` refuses to return anything that does not satisfy these rules, so the
Node calculator never receives a malformed observation from this extractor.
"""

from __future__ import annotations

import re

from .common import RETRIEVALS, SCHEMA_VERSION, SITES

MAX_SAFE_INTEGER = 2**53 - 1
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_TIME = re.compile(r"(?:[01]\d|2[0-3]):[0-5]\d")
_SHA = re.compile(r"[a-f0-9]{64}")
_WARNING = re.compile(r"[A-Z][A-Z0-9_]{2,63}")
_CURRENCY = re.compile(r"[A-Z]{3}")

_TOP_KEYS = {
    "schemaVersion",
    "source",
    "title",
    "destination",
    "modal",
    "departure",
    "returnDeparture",
    "returnArrival",
    "days",
    "nights",
    "lodging",
    "breakfast",
    "price",
    "mandatoryFees",
    "included",
    "excluded",
    "boardingCities",
    "evidence",
    "warnings",
}


def _is_int(value, minimum: int = 0, maximum: int = MAX_SAFE_INTEGER) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and minimum <= value <= maximum


def _text(value, max_length: int) -> bool:
    return isinstance(value, str) and 1 <= len(value) <= max_length


def _keys(value, keys: set[str]) -> bool:
    return isinstance(value, dict) and set(value) == keys


def validate_observation(obs: object) -> list[str]:
    """Return a list of contract violations (empty when the observation conforms)."""
    errors: list[str] = []

    def check(condition: bool, path: str) -> None:
        if not condition:
            errors.append(path)

    if not _keys(obs, _TOP_KEYS):
        return ["keys"]
    assert isinstance(obs, dict)
    check(obs["schemaVersion"] == SCHEMA_VERSION, "schemaVersion")
    source = obs["source"]
    if _keys(source, {"url", "site", "observedAt", "retrieval", "contentSha256"}):
        check(_text(source["url"], 2048) and source["url"].startswith("https://"), "source.url")
        check(source["site"] in SITES, "source.site")
        check(isinstance(source["observedAt"], str), "source.observedAt")
        check(source["retrieval"] in RETRIEVALS, "source.retrieval")
        check(
            isinstance(source["contentSha256"], str) and bool(_SHA.fullmatch(source["contentSha256"])),
            "source.sha",
        )
    else:
        errors.append("source")
    for key, limit in (("title", 300), ("destination", 200)):
        check(obs[key] is None or _text(obs[key], limit), key)
    check(obs["modal"] in ("bus", "air", "mixed", "unknown"), "modal")
    for key in ("departure", "returnDeparture", "returnArrival"):
        moment = obs[key]
        if not _keys(moment, {"date", "time", "yearStated"}):
            errors.append(key)
            continue
        check(
            moment["date"] is None
            or (isinstance(moment["date"], str) and bool(_DATE.fullmatch(moment["date"]))),
            key,
        )
        check(
            moment["time"] is None
            or (isinstance(moment["time"], str) and bool(_TIME.fullmatch(moment["time"]))),
            key,
        )
        check(isinstance(moment["yearStated"], bool), key)
    check(obs["days"] is None or _is_int(obs["days"], 1, 60), "days")
    check(obs["nights"] is None or _is_int(obs["nights"], 0, 60), "nights")
    lodging = obs["lodging"]
    if _keys(lodging, {"name", "nightsIncluded"}):
        check(lodging["name"] is None or _text(lodging["name"], 200), "lodging.name")
        check(
            lodging["nightsIncluded"] is None or _is_int(lodging["nightsIncluded"], 0, 60), "lodging.nights"
        )
    else:
        errors.append("lodging")
    breakfast = obs["breakfast"]
    if _keys(breakfast, {"status", "count"}):
        check(breakfast["status"] in ("included", "excluded", "partial", "unknown"), "breakfast.status")
        check(breakfast["count"] is None or _is_int(breakfast["count"], 0, 120), "breakfast.count")
    else:
        errors.append("breakfast")
    price = obs["price"]
    if _keys(price, {"amountMinor", "currency", "basis", "qualifier", "installments"}):
        check(price["amountMinor"] is None or _is_int(price["amountMinor"]), "price.amountMinor")
        check(
            isinstance(price["currency"], str) and bool(_CURRENCY.fullmatch(price["currency"])),
            "price.currency",
        )
        check(price["basis"] in ("per_person", "per_room", "per_group", "unknown"), "price.basis")
        check(price["qualifier"] in ("exact", "from", "unknown"), "price.qualifier")
        installments = price["installments"]
        check(
            installments is None
            or (
                _keys(installments, {"count", "amountMinor"})
                and _is_int(installments["count"], 1, 60)
                and _is_int(installments["amountMinor"])
            ),
            "price.installments",
        )
    else:
        errors.append("price")
    fees = obs["mandatoryFees"]
    check(isinstance(fees, list) and len(fees) <= 20, "mandatoryFees")
    for fee in fees if isinstance(fees, list) else []:
        check(
            _keys(fee, {"label", "amountMinor", "basis", "payment"})
            and _text(fee["label"], 120)
            and _is_int(fee["amountMinor"])
            and fee["basis"] in ("per_person", "per_group", "unknown")
            and fee["payment"] in ("in_package", "paid_locally", "unknown"),
            "mandatoryFees[]",
        )
    for key, max_items, limit in (("included", 40, 160), ("excluded", 40, 160), ("boardingCities", 20, 80)):
        items = obs[key]
        check(
            isinstance(items, list) and len(items) <= max_items and all(_text(i, limit) for i in items), key
        )
    evidence = obs["evidence"]
    check(isinstance(evidence, list) and len(evidence) <= 60, "evidence")
    for item in evidence if isinstance(evidence, list) else []:
        check(
            _keys(item, {"field", "quote"}) and _text(item["field"], 80) and _text(item["quote"], 240),
            "evidence[]",
        )
    warnings = obs["warnings"]
    check(
        isinstance(warnings, list)
        and len(warnings) <= 30
        and len(set(warnings)) == len(warnings)
        and all(isinstance(w, str) and _WARNING.fullmatch(w) for w in warnings),
        "warnings",
    )
    return errors
