"""Optional real-public-source smoke, never a synthetic quote or an availability guarantee."""
from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

from travel_ingest.packages import PackageError, parse_package
from travel_ingest.packages.render_sandbox import render_isolated

pytestmark = pytest.mark.skipif(os.environ.get("TRAVEL_RENDERER_PUBLIC_SMOKE") != "1",
                                reason="Explicit public-source read opt-in is required")
SOURCES = [
    ("atrativa-1823", "https://atrativatur.com.br/viagem.php?v=1823"),
    ("augustus-christmas", "https://augustusturismo.com.br/#/pacote/morro-de-sao-paulo-natal-2026-619-2026-12-23"),
]


def test_public_provider_pages_are_either_rendered_with_provenance_or_explicitly_unavailable():
    records = []
    for identifier, url in SOURCES:
        try:
            value = render_isolated(url, timeout_ms=60000)
            html = value["html"]
            observed = datetime.now(timezone.utc).isoformat()
            observation = parse_package(html, url=url, observed_at=observed, retrieval="rendered_dom")
            records.append({"sourceId": identifier, "status": "RENDERED", "htmlSha256": hashlib.sha256(html.encode()).hexdigest(),
                            "htmlBytes": len(html.encode()), "isolatedNetwork": value["isolation"]["network"] == "none",
                            "sourceResources": len(value["provenance"]["resources"]),
                            "literalExtractionValidated": observation["schemaVersion"] == "package-observation/1",
                            "operatorCredentialsUsed": False, "personalDocumentsUsed": False})
        except PackageError as error:
            # No fallback renderer, seed package, quote, stale page or host browser is used.
            records.append({"sourceId": identifier, "status": "UNAVAILABLE", "reason": error.code,
                            "fallbackUsed": False, "personalDocumentsUsed": False})
    report = {"status": "RENDERED_AT_LEAST_ONE" if any(row["status"] == "RENDERED" for row in records) else "UNAVAILABLE",
              "records": records, "htmlSaved": False, "pricesLogged": False, "contactsLogged": False,
              "availabilityConfirmed": False, "modelCalls": 0}
    destination = Path.cwd() / ".local/renderer/public-smoke.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    assert report["status"] == "RENDERED_AT_LEAST_ONE", "PUBLIC_RENDERER_UNAVAILABLE_SEE_SANITIZED_REPORT"
