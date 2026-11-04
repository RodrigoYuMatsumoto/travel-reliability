"""fetch_rendered guards. Every test injects fakes; the real network is patched to fail."""

import sys
import urllib.request

import pytest

from travel_ingest.packages import PackageError, parse_package
from travel_ingest.packages import fetch as fetch_module
from travel_ingest.packages.fetch import USER_AGENT, content_signal_denies_ai_input, fetch_rendered

OBSERVED_AT = "2026-11-04T12:00:00-03:00"
URL = "https://www.atrativatur.com.br/viagem.php?v=101"
PAGE = "<h1>Pacote Sintético</h1><p>Valor à vista: R$ 10,00</p>"


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("network access attempted in a test")

    monkeypatch.setattr(urllib.request, "urlopen", refuse)
    monkeypatch.setattr(fetch_module.urllib.request, "urlopen", refuse)


class FakeRenderer:
    """Returns the page and the URL the browser "ended on" (the requested one by default)."""

    def __init__(self, html: str = PAGE, final_url: str | None = None):
        self.html = html
        self.final_url = final_url
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, url: str, **kwargs) -> dict:
        self.calls.append((url, kwargs))
        return {"html": self.html, "finalUrl": self.final_url or url}


def never_render(url, **kwargs):
    raise AssertionError("renderer must not run")


def robots(text):
    seen: list[str] = []

    def fetcher(url: str):
        seen.append(url)
        return text

    fetcher.seen = seen
    return fetcher


def code_of(callable_, *args, **kwargs) -> str:
    with pytest.raises(PackageError) as caught:
        callable_(*args, **kwargs)
    return caught.value.code


@pytest.mark.parametrize("flag", [False, None, "yes", 1])
def test_network_requires_explicit_true(flag):
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=flag,
            renderer=never_render,
            robots_fetcher=robots(None),
        )
        == "NETWORK_NOT_ALLOWED"
    )


@pytest.mark.parametrize(
    "url,code",
    [
        ("http://www.atrativatur.com.br/viagem.php?v=1", "URL_NOT_HTTPS"),
        ("https://example.invalid/pacote", "HOST_NOT_SUPPORTED"),
        ("https://outraagencia.suareservaonline.com.br/pacote", "HOST_NOT_SUPPORTED"),
        ("https://atrativatur.com.br.example.invalid/", "HOST_NOT_SUPPORTED"),
        ("https://www.atrativatur.com.br:8443/viagem.php?v=1", "URL_INVALID"),
        ("https://www.instagram.com/agencia.sintetica/", "INSTAGRAM_NOT_SUPPORTED"),
    ],
)
def test_only_https_on_supported_hosts(url, code):
    assert (
        code_of(
            fetch_rendered,
            url,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(None),
        )
        == code
    )


@pytest.mark.parametrize(
    "robots_text",
    [
        "User-agent: *\nDisallow: /",
        "User-agent: TravelReliabilityPackageReader\nDisallow: /viagem.php\n\nUser-agent: *\nAllow: /",
    ],
)
def test_robots_disallow_is_respected(robots_text):
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(robots_text),
        )
        == "ROBOTS_DISALLOWED"
    )


@pytest.mark.parametrize(
    "robots_text",
    [
        "User-agent: *\nContent-Signal: search=yes, ai-train=no, ai-input=no\nAllow: /",
        "Content-Signal: ai-input=no\n\nUser-agent: *\nAllow: /",
        "User-agent: TravelReliabilityPackageReader\nContent-signal: AI-Input = No",
    ],
)
def test_content_signal_ai_input_no_is_a_refusal(robots_text):
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(robots_text),
        )
        == "CONTENT_SIGNAL_AI_INPUT_NO"
    )


def test_content_signal_for_another_agent_does_not_apply():
    text = "User-agent: OtherBot\nContent-Signal: ai-input=no\n\nUser-agent: *\nContent-Signal: ai-input=yes\nAllow: /"
    assert content_signal_denies_ai_input(text) is False


def test_robots_fetch_failure_refuses():
    def broken(url):
        raise OSError("boom")

    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=broken,
        )
        == "ROBOTS_UNAVAILABLE"
    )


def test_playwright_missing_is_a_stable_error(monkeypatch):
    monkeypatch.setitem(sys.modules, "playwright", None)
    monkeypatch.setitem(sys.modules, "playwright.sync_api", None)
    assert (
        code_of(fetch_rendered, URL, observed_at=OBSERVED_AT, allow_network=True, robots_fetcher=robots(None))
        == "PLAYWRIGHT_NOT_INSTALLED"
    )


def test_happy_path_with_fakes_and_parse_of_rendered_dom():
    renderer = FakeRenderer()
    fetcher = robots("User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes")
    result = fetch_rendered(
        URL, observed_at=OBSERVED_AT, allow_network=True, renderer=renderer, robots_fetcher=fetcher
    )
    assert result == {"html": PAGE, "retrieval": "rendered_dom", "url": URL}
    assert fetcher.seen == ["https://www.atrativatur.com.br/robots.txt"]
    url, kwargs = renderer.calls[0]
    assert url == URL
    assert kwargs["user_agent"] == USER_AGENT
    assert kwargs["timeout_ms"] > 0
    assert kwargs["max_bytes"] == 5 * 1024 * 1024
    observation = parse_package(
        result["html"], url=result["url"], observed_at=OBSERVED_AT, retrieval=result["retrieval"]
    )
    assert observation["source"]["site"] == "atrativa"
    assert observation["price"]["amountMinor"] == 1000


def test_augustus_hash_route_is_checked_against_robots_without_fragment():
    renderer = FakeRenderer("<div class='detail-info'><h1>Pacote</h1></div>")
    url = "https://augustusturismo.com.br/#/pacote/7"
    result = fetch_rendered(
        url,
        observed_at=OBSERVED_AT,
        allow_network=True,
        renderer=renderer,
        robots_fetcher=robots("User-agent: *\nDisallow: /admin"),
    )
    assert result["url"] == url


def test_renderer_output_limits_and_failures():
    too_big = FakeRenderer("a" * (5 * 1024 * 1024 + 1))
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=too_big,
            robots_fetcher=robots(None),
        )
        == "HTML_TOO_LARGE"
    )

    def crash(url, **kwargs):
        raise RuntimeError("renderer crashed with page text")

    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=crash,
            robots_fetcher=robots(None),
        )
        == "RENDER_FAILED"
    )


# --- D4: RFC 9309 matching -------------------------------------------------------------------


@pytest.mark.parametrize(
    "robots_text,url,allowed",
    [
        # Longest match wins, whatever the order of the rules.
        (
            "User-agent: *\nAllow: /\nDisallow: /viagem.php",
            "https://www.atrativatur.com.br/viagem.php?v=1",
            False,
        ),
        (
            "User-agent: *\nDisallow: /viagem.php\nAllow: /",
            "https://www.atrativatur.com.br/viagem.php?v=1",
            False,
        ),
        ("User-agent: *\nAllow: /\nDisallow: /viagem.php", "https://www.atrativatur.com.br/index.php", True),
        # Wildcards.
        ("User-agent: *\nDisallow: /*?v=", "https://www.atrativatur.com.br/viagem.php?v=1", False),
        ("User-agent: *\nDisallow: /*?v=", "https://www.atrativatur.com.br/viagem.php?local=", True),
        ("User-agent: *\nDisallow: /*.php$", "https://www.atrativatur.com.br/x.php", False),
        ("User-agent: *\nDisallow: /*.php$", "https://www.atrativatur.com.br/x.php?v=1", True),
        # Allow wins a tie of equal length.
        (
            "User-agent: *\nDisallow: /viagem\nAllow: /viagem",
            "https://www.atrativatur.com.br/viagem.php",
            True,
        ),
        # A more specific Allow carves out an exception.
        (
            "User-agent: *\nDisallow: /\nAllow: /viagem.php",
            "https://www.atrativatur.com.br/viagem.php?v=1",
            True,
        ),
        # An empty Disallow blocks nothing; our own group beats the "*" group.
        ("User-agent: *\nDisallow:", "https://www.atrativatur.com.br/viagem.php", True),
        (
            "User-agent: *\nDisallow: /\n\nUser-agent: travelreliabilitypackagereader\nAllow: /",
            "https://www.atrativatur.com.br/viagem.php",
            True,
        ),
        # Percent-encoded unreserved characters compare equal to their plain form.
        ("User-agent: *\nDisallow: /%76iagem.php", "https://www.atrativatur.com.br/viagem.php", False),
    ],
)
def test_robots_rfc9309_matching(robots_text, url, allowed):
    assert fetch_module.robots_allows(robots_text, url) is allowed


def test_rfc9309_disallow_blocks_fetch_even_after_allow_all():
    assert (
        code_of(
            fetch_rendered,
            "https://www.atrativatur.com.br/viagem.php?v=1",
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots("User-agent: *\nAllow: /\nDisallow: /viagem.php"),
        )
        == "ROBOTS_DISALLOWED"
    )


def test_wildcard_pattern_is_linear_on_hostile_input():
    hostile = "User-agent: *\nDisallow: /" + "*a" * 2000 + "$"
    assert fetch_module.robots_allows(hostile, "https://www.atrativatur.com.br/" + "a" * 1500 + "b") is True


# --- D5: byte order mark ------------------------------------------------------------------------

BOM = chr(0xFEFF)


def test_bom_before_user_agent_still_blocks():
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(BOM + "User-agent: *\nDisallow: /"),
        )
        == "ROBOTS_DISALLOWED"
    )


def test_bom_before_content_signal_still_refuses():
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(BOM + "Content-Signal: ai-input=no\nUser-agent: *\nAllow: /"),
        )
        == "CONTENT_SIGNAL_AI_INPUT_NO"
    )


def test_default_robots_fetcher_decodes_utf8_sig(monkeypatch):
    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def geturl(self):
            return "https://www.atrativatur.com.br/robots.txt"

        def read(self, limit):
            return (BOM + "User-agent: *\nDisallow: /").encode("utf-8")

    monkeypatch.setattr(fetch_module.urllib.request, "urlopen", lambda *args, **kwargs: Response())
    text = fetch_module._default_robots_fetcher("https://www.atrativatur.com.br/robots.txt")
    assert not text.startswith(BOM)
    assert fetch_module.robots_allows(text, URL) is False


# --- D6: redirects ----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "final_url",
    [
        "https://www.atrativatur.com.br/outra-pagina.php",
        "https://atrativatur.com.br/viagem.php?v=101",
        "https://www.atrativatur.com.br/viagem.php?v=102",
        "http://www.atrativatur.com.br/viagem.php?v=101",
        "https://example.invalid/viagem.php?v=101",
    ],
)
def test_render_that_ends_elsewhere_is_refused(final_url):
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=FakeRenderer(final_url=final_url),
            robots_fetcher=robots(None),
        )
        == "REDIRECT_NOT_ALLOWED"
    )


@pytest.mark.parametrize(
    "requested,final_url",
    [
        ("https://augustusturismo.com.br/#/pacote/7", "https://augustusturismo.com.br/#/pacote/7"),
        ("https://augustusturismo.com.br/#/pacote/7", "https://augustusturismo.com.br/#/pacotes"),
        ("https://augustusturismo.com.br", "https://augustusturismo.com.br/"),
        (
            "https://www.atrativatur.com.br/viagem.php?v=101",
            "https://www.atrativatur.com.br:443/viagem.php?v=101",
        ),
    ],
)
def test_same_document_ignores_fragment_and_trivial_normalisation(requested, final_url):
    result = fetch_rendered(
        requested,
        observed_at=OBSERVED_AT,
        allow_network=True,
        renderer=FakeRenderer(final_url=final_url),
        robots_fetcher=robots(None),
    )
    assert result["url"] == requested


def test_renderer_must_report_its_final_url():
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=lambda url, **kwargs: PAGE,
            robots_fetcher=robots(None),
        )
        == "RENDER_FAILED"
    )


def test_observed_at_is_validated_before_network():
    assert (
        code_of(
            fetch_rendered,
            URL,
            observed_at="ontem",
            allow_network=True,
            renderer=never_render,
            robots_fetcher=robots(None),
        )
        == "OBSERVED_AT_INVALID"
    )
