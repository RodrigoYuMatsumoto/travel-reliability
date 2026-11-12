"""Unit bridge checks; real Docker containment has a separate mandatory CI test."""
import pytest

from travel_ingest.packages import fetch as module
from travel_ingest.packages.errors import PackageError

URL = "https://augustusturismo.com.br/#/pacote/synthetic-2026-12-30"
OBSERVED = "2026-11-11T12:00:00Z"


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("TRAVEL_RELIABILITY_RENDERER_IMAGE", "sha256:" + "a" * 64)


def test_without_image_fails_before_any_adapter_or_network(monkeypatch):
    monkeypatch.delenv("TRAVEL_RELIABILITY_RENDERER_IMAGE", raising=False)
    monkeypatch.setattr(module, "_playwright_renderer", lambda *args, **kwargs: pytest.fail("unexpected adapter"))
    with pytest.raises(PackageError, match="NETWORK_RENDERER_UNAVAILABLE"):
        module.fetch_rendered(URL, observed_at=OBSERVED, allow_network=True)


def test_network_consent_is_required_even_with_operator_image(configured, monkeypatch):
    monkeypatch.setattr(module, "_playwright_renderer", lambda *args, **kwargs: pytest.fail("unexpected adapter"))
    with pytest.raises(PackageError, match="NETWORK_NOT_ALLOWED"):
        module.fetch_rendered(URL, observed_at=OBSERVED, allow_network=False)


def test_automatic_bridge_preserves_backend_receipts(configured, monkeypatch):
    rendered = {"html": "<p>Synthetic</p>", "finalUrl": URL,
                "isolation": {"syntheticUnitTest": True}, "provenance": {"syntheticUnitTest": True}}
    monkeypatch.setattr(module, "_playwright_renderer", lambda *args, **kwargs: rendered)
    value = module.fetch_rendered(URL, observed_at=OBSERVED, allow_network=True)
    assert value["retrieval"] == "rendered_dom"
    assert value["url"] == URL
    assert value["isolation"] is rendered["isolation"]
    assert value["provenance"] is rendered["provenance"]


@pytest.mark.parametrize("change,code", [
    ({"finalUrl": URL + "-other"}, "REDIRECT_NOT_ALLOWED"),
    ({"isolation": None}, "RENDER_PROVENANCE_MISSING"),
    ({"provenance": None}, "RENDER_PROVENANCE_MISSING"),
    ({"html": 12}, "RENDER_FAILED"),
    ({"html": "a" * (module.MAX_HTML_BYTES + 1)}, "HTML_TOO_LARGE"),
])
def test_automatic_output_is_validated(configured, monkeypatch, change, code):
    rendered = {"html": "<p>Synthetic</p>", "finalUrl": URL, "isolation": {}, "provenance": {}}
    rendered.update(change)
    monkeypatch.setattr(module, "_playwright_renderer", lambda *args, **kwargs: rendered)
    with pytest.raises(PackageError, match=code):
        module.fetch_rendered(URL, observed_at=OBSERVED, allow_network=True)


def test_complete_fixture_does_not_inherit_network_claim(configured, monkeypatch):
    monkeypatch.setattr(module, "_playwright_renderer", lambda *args, **kwargs: pytest.fail("unexpected adapter"))
    value = module.fetch_rendered(URL, observed_at=OBSERVED, allow_network=True,
                                 renderer=lambda url, **kwargs: {"html": "<p>Synthetic</p>", "finalUrl": url},
                                 robots_fetcher=lambda url: None)
    assert value == {"html": "<p>Synthetic</p>", "url": URL, "retrieval": "fixture"}
