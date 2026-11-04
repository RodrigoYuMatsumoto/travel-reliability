"""Opt-in rendering of a supported package page.

Network access requires ``allow_network=True``. Only https URLs on the four supported
agency hosts are accepted. robots.txt is checked first for the
``TravelReliabilityPackageReader`` user agent with RFC 9309 matching (longest match wins,
``Allow`` wins a tie, ``*`` and ``$`` are supported), and a ``Content-Signal`` with
``ai-input=no`` is a refusal. The default renderer imports Playwright lazily (it is an
optional dependency) and blocks images, media, fonts and downloads; JavaScript runs because
some sites (Augustus) are single-page apps. A render that ends on any URL other than the one
requested (ignoring the fragment) is refused.
"""

from __future__ import annotations

import re
import string
import urllib.error
import urllib.request
from typing import Callable
from urllib.parse import quote, urlsplit

from . import detect_site
from .common import MAX_HTML_BYTES, check_observed_at, check_url
from .errors import PackageError

USER_AGENT = "TravelReliabilityPackageReader"
ALLOWED_HOSTS = frozenset(
    {
        "atrativatur.com.br",
        "www.atrativatur.com.br",
        "nielturismo.suareservaonline.com.br",
        "viajantesdovalle.com.br",
        "www.viajantesdovalle.com.br",
        "augustusturismo.com.br",
        "www.augustusturismo.com.br",
    }
)
RENDER_TIMEOUT_MS = 30_000
ROBOTS_TIMEOUT_S = 10
ROBOTS_MAX_BYTES = 512 * 1024
_BLOCKED_RESOURCES = frozenset({"image", "media", "font"})
_BOM = chr(0xFEFF)
_UNRESERVED = frozenset(string.ascii_letters + string.digits + "-._~")

# A renderer returns {"html": str, "finalUrl": str}; finalUrl is the address the browser
# ended on, so redirects can be checked.
Renderer = Callable[..., dict]
RobotsFetcher = Callable[[str], "str | None"]


def _check_target(url: str) -> tuple[str, str]:
    url = check_url(url)
    detect_site(url)  # refuses Instagram with a stable code
    parts = urlsplit(url)
    if parts.port not in (None, 443):
        raise PackageError("URL_INVALID")
    host = (parts.hostname or "").lower().rstrip(".")
    if host not in ALLOWED_HOSTS:
        raise PackageError("HOST_NOT_SUPPORTED")
    return url, host


# ---------------------------------------------------------------------------
# robots.txt (RFC 9309)
# ---------------------------------------------------------------------------


def _records(robots_text: str):
    """(key, value) pairs with comments, whitespace and any byte order mark removed."""
    for raw in robots_text.replace(_BOM, "").splitlines():
        line = raw.split("#", 1)[0].strip()
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        yield key.strip().lower(), value.strip()


def _agent_matches(value: str, agent: str = USER_AGENT) -> bool:
    token = value.split("/", 1)[0].strip().lower()
    return token == agent.lower()


def _groups(robots_text: str) -> list[tuple[list[str], list[tuple[bool, str]]]]:
    """Groups of (user agents, [(is_allow, pattern)]). Consecutive user-agent lines share a group."""
    groups: list[tuple[list[str], list[tuple[bool, str]]]] = []
    current: tuple[list[str], list[tuple[bool, str]]] | None = None
    collecting_agents = False
    for key, value in _records(robots_text):
        if key == "user-agent":
            if current is None or not collecting_agents:
                current = ([], [])
                groups.append(current)
            current[0].append(value)
            collecting_agents = True
            continue
        collecting_agents = False
        if key in ("allow", "disallow") and current is not None:
            current[1].append((key == "allow", value))
    return groups


def _normalise_path(text: str) -> str:
    """Percent-encode non-ASCII, decode unreserved escapes and upper-case the rest (RFC 9309 2.2.2)."""
    encoded = "".join(char if ord(char) < 128 else quote(char, safe="") for char in text)

    def fix(match: re.Match) -> str:
        char = chr(int(match[1], 16))
        return char if char in _UNRESERVED else "%" + match[1].upper()

    return re.sub(r"%([0-9A-Fa-f]{2})", fix, encoded)


def _pattern_matches(pattern: str, target: str) -> bool:
    """RFC 9309 path matching: ``*`` is any sequence; a trailing ``$`` anchors the end.

    Segments are matched left to right with ``str.find``; this is linear and cannot
    backtrack catastrophically on hostile patterns.
    """
    anchored = pattern.endswith("$")
    body = pattern[:-1] if anchored else pattern
    parts = body.split("*")
    if not target.startswith(parts[0]):
        return False
    position = len(parts[0])
    if len(parts) == 1:
        return not anchored or position == len(target)
    for part in parts[1:-1]:
        found = target.find(part, position)
        if found < 0:
            return False
        position = found + len(part)
    last = parts[-1]
    if anchored:
        return target.endswith(last) and len(target) - len(last) >= position
    return target.find(last, position) >= 0


def robots_allows(robots_text: str, url: str, agent: str = USER_AGENT) -> bool:
    """RFC 9309 decision for ``url``: the most specific matching rule wins, ``Allow`` on a tie."""
    groups = _groups(robots_text)
    chosen = [group for group in groups if any(_agent_matches(item, agent) for item in group[0])]
    if not chosen:
        chosen = [group for group in groups if any(item.strip() == "*" for item in group[0])]
    parts = urlsplit(url)
    target = _normalise_path((parts.path or "/") + (f"?{parts.query}" if parts.query else ""))
    if target == "/robots.txt":
        return True
    best: tuple[int, bool] | None = None
    for group in chosen:
        for is_allow, pattern in group[1]:
            if not pattern:
                continue  # an empty rule matches nothing
            if _pattern_matches(_normalise_path(pattern), target):
                key = (len(pattern), is_allow)
                if best is None or key > best:
                    best = key
    return best is None or best[1]


def content_signal_denies_ai_input(robots_text: str, user_agent: str = USER_AGENT) -> bool:
    """True when a ``Content-Signal`` line that applies to us carries ``ai-input=no``."""
    group: list[str] = []
    collecting_agents = False
    applies = True  # lines before any User-agent group apply to everyone
    for key, value in _records(robots_text):
        if key == "user-agent":
            if not collecting_agents:
                group = []
                collecting_agents = True
            group.append(value)
            applies = any(item.strip() == "*" or _agent_matches(item, user_agent) for item in group)
            continue
        collecting_agents = False
        if key == "content-signal" and applies:
            for part in value.split(","):
                name, _, setting = part.partition("=")
                if name.strip().lower() == "ai-input" and setting.strip().lower() == "no":
                    return True
    return False


def check_robots(robots_text: str | None, url: str) -> None:
    """Raise unless robots.txt allows ``url`` for our user agent."""
    if robots_text is None:
        return  # no robots.txt (4xx): crawling is allowed
    if not isinstance(robots_text, str) or len(robots_text.encode("utf-8", "replace")) > ROBOTS_MAX_BYTES:
        raise PackageError("ROBOTS_UNAVAILABLE")
    robots_text = robots_text.replace(_BOM, "")
    if content_signal_denies_ai_input(robots_text):
        raise PackageError("CONTENT_SIGNAL_AI_INPUT_NO")
    if not robots_allows(robots_text, url):
        raise PackageError("ROBOTS_DISALLOWED")


def _default_robots_fetcher(robots_url: str) -> str | None:
    request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=ROBOTS_TIMEOUT_S) as response:  # noqa: S310 - https only
            if urlsplit(response.geturl()).scheme != "https":
                raise PackageError("ROBOTS_UNAVAILABLE")
            body = response.read(ROBOTS_MAX_BYTES + 1)
    except urllib.error.HTTPError as error:
        if 400 <= error.code < 500 and error.code != 429:
            return None
        raise PackageError("ROBOTS_UNAVAILABLE") from None
    except (urllib.error.URLError, TimeoutError, OSError):
        raise PackageError("ROBOTS_UNAVAILABLE") from None
    if len(body) > ROBOTS_MAX_BYTES:
        raise PackageError("ROBOTS_UNAVAILABLE")
    return body.decode("utf-8-sig", "replace")


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _comparable(url: str) -> tuple[str, str, int | None, str, str]:
    """URL without fragment, normalised the way browsers report it (``https://h`` == ``https://h/``)."""
    parts = urlsplit(url)
    try:
        port = parts.port
    except ValueError:
        raise PackageError("REDIRECT_NOT_ALLOWED") from None
    if port == 443:
        port = None
    return (
        parts.scheme.lower(),
        (parts.hostname or "").lower().rstrip("."),
        port,
        _normalise_path(parts.path or "/"),
        _normalise_path(parts.query),
    )


def same_document(requested: str, final: str) -> bool:
    return _comparable(requested) == _comparable(final)


def _playwright_renderer(url: str, *, user_agent: str, timeout_ms: int, max_bytes: int) -> dict:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise PackageError("PLAYWRIGHT_NOT_INSTALLED") from None

    def route(request_route) -> None:
        if request_route.request.resource_type in _BLOCKED_RESOURCES:
            request_route.abort()
        else:
            request_route.continue_()

    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            try:
                context = browser.new_context(
                    user_agent=user_agent,
                    java_script_enabled=True,
                    accept_downloads=False,
                    service_workers="block",
                )
                context.set_default_timeout(timeout_ms)
                context.route("**/*", route)
                page = context.new_page()
                page.goto(url, wait_until="networkidle", timeout=timeout_ms)
                final_url = page.url
                html = page.content()
            finally:
                browser.close()
    except PlaywrightError:
        raise PackageError("RENDER_FAILED") from None
    if len(html.encode("utf-8", "replace")) > max_bytes:
        raise PackageError("HTML_TOO_LARGE")
    return {"html": html, "finalUrl": final_url}


def fetch_rendered(
    url: str,
    *,
    observed_at: str,
    allow_network: bool,
    renderer: Renderer | None = None,
    robots_fetcher: RobotsFetcher | None = None,
) -> dict:
    """Render ``url`` after the network opt-in, host allowlist and robots.txt checks."""
    if allow_network is not True:
        raise PackageError("NETWORK_NOT_ALLOWED")
    url, host = _check_target(url)
    check_observed_at(observed_at)
    fetch_robots = robots_fetcher or _default_robots_fetcher
    try:
        robots_text = fetch_robots(f"https://{host}/robots.txt")
    except PackageError:
        raise
    except Exception:
        raise PackageError("ROBOTS_UNAVAILABLE") from None
    check_robots(robots_text, url)
    render = renderer or _playwright_renderer
    try:
        rendered = render(url, user_agent=USER_AGENT, timeout_ms=RENDER_TIMEOUT_MS, max_bytes=MAX_HTML_BYTES)
    except PackageError:
        raise
    except Exception:
        raise PackageError("RENDER_FAILED") from None
    if not isinstance(rendered, dict):
        raise PackageError("RENDER_FAILED")
    html, final_url = rendered.get("html"), rendered.get("finalUrl")
    if not isinstance(html, str) or not isinstance(final_url, str):
        raise PackageError("RENDER_FAILED")
    # Any redirect (same host or not) means the page is not the one robots.txt approved.
    if not same_document(url, final_url):
        raise PackageError("REDIRECT_NOT_ALLOWED")
    if len(html) > MAX_HTML_BYTES or len(html.encode("utf-8", "replace")) > MAX_HTML_BYTES:
        raise PackageError("HTML_TOO_LARGE")
    return {"html": html, "retrieval": "rendered_dom", "url": url}
