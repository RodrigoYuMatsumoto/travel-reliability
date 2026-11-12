"""Opt-in isolated package rendering and bounded robots.txt checks.

The operator must provision an immutable Docker renderer image. Without it, automatic
rendering fails before DNS or browser launch. The browser has no network; the host broker
alone supplies approved read-only resources. In-process callbacks remain fixture-only.
Product identity retains its exact SPA fragment, and source facts remain unconfirmed.
"""

from __future__ import annotations

import http.client
import ipaddress
import os
import queue
import re
import socket
import ssl
import string
import threading
import time
from dataclasses import dataclass
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
_BOM = chr(0xFEFF)
_UNRESERVED = frozenset(string.ascii_letters + string.digits + "-._~")

# Trusted in-process fixture callbacks, never accepted from CLI/MCP input. A renderer
# returns {"html": str, "finalUrl": str}. They do not establish network provenance.
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
    product_agent = value.split("/", 1)[0].strip().lower()
    return product_agent == agent.lower()


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


@dataclass(frozen=True)
class _PinnedEndpoint:
    host: str
    address: str
    family: int


def _public_ip(value: str) -> bool:
    """Reject every non-global address, including IPv4-mapped private IPv6."""
    try:
        if "%" in value:  # scoped IPv6 is never a public Internet endpoint
            return False
        address = ipaddress.ip_address(value)
        if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
            return _public_ip(str(address.ipv4_mapped))
        return address.is_global and not any(
            (address.is_multicast, address.is_reserved, address.is_unspecified, address.is_loopback)
        )
    except ValueError:
        return False


def _remaining(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError
    return remaining


def _resolve_public_endpoint(host: str, deadline: float) -> _PinnedEndpoint:
    """Resolve once; reject the entire answer if any usable address is not public.

    getaddrinfo has no portable timeout. Its daemon worker cannot keep a failed request
    alive; no socket is opened by this worker. The caller shares one absolute deadline
    with TCP, TLS and response reads, rather than restarting a timeout per operation.
    """
    results: queue.Queue = queue.Queue(maxsize=1)

    def resolve() -> None:
        try:
            answers = socket.getaddrinfo(host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
            results.put((answers, None))
        except Exception as error:
            results.put((None, error))

    threading.Thread(target=resolve, daemon=True, name="package-robots-dns").start()
    try:
        answers, error = results.get(timeout=_remaining(deadline))
    except queue.Empty:
        raise PackageError("ROBOTS_UNAVAILABLE") from None
    if error is not None or not answers:
        raise PackageError("ROBOTS_UNAVAILABLE")
    endpoints: list[_PinnedEndpoint] = []
    for family, sock_type, protocol, _, sockaddr in answers:
        if (
            family not in (socket.AF_INET, socket.AF_INET6)
            or sock_type != socket.SOCK_STREAM
            or protocol not in (0, socket.IPPROTO_TCP)
            or not _public_ip(sockaddr[0])
            or sockaddr[1] != 443
        ):
            raise PackageError("ROBOTS_UNAVAILABLE")
        endpoints.append(_PinnedEndpoint(host, sockaddr[0], family))
    # There is no connection-time DNS lookup and no retry/fallback to a changed answer.
    return endpoints[0]


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Preserve Host/SNI/certificate identity while connecting to one vetted IP."""

    def __init__(self, endpoint: _PinnedEndpoint, *, deadline: float):
        self._endpoint = endpoint
        self._deadline = deadline
        self._active_socket = None
        super().__init__(
            endpoint.host,
            443,
            timeout=_remaining(deadline),
            context=ssl.create_default_context(),
        )

    def connect(self) -> None:
        # A raw socket connects to an IP literal: create_connection/getaddrinfo would
        # introduce a second resolution and invalidate the preflight pin.
        raw_socket = socket.socket(self._endpoint.family, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        self._active_socket = raw_socket
        try:
            raw_socket.settimeout(_remaining(self._deadline))
            address = (self._endpoint.address, 443)
            if self._endpoint.family == socket.AF_INET6:
                address = (self._endpoint.address, 443, 0, 0)
            raw_socket.connect(address)
            if ipaddress.ip_address(raw_socket.getpeername()[0]) != ipaddress.ip_address(
                self._endpoint.address
            ):
                raise OSError("peer address mismatch")
            raw_socket.settimeout(_remaining(self._deadline))
            self.sock = self._context.wrap_socket(raw_socket, server_hostname=self._endpoint.host)
            self._active_socket = self.sock
        except BaseException:
            raw_socket.close()
            raise

    def cancel(self) -> None:
        """Interrupt slow headers/body as well as connect/TLS at the absolute deadline."""
        active_socket = self._active_socket
        if active_socket is not None:
            try:
                active_socket.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            active_socket.close()
        self.close()


def _default_robots_fetcher(robots_url: str) -> str | None:
    """Bounded GET to the exact allowlisted HTTPS /robots.txt, with public-IP pinning."""
    connection = None
    watchdog = None
    try:
        robots_url, host = _check_target(robots_url)
        parts = urlsplit(robots_url)
        if parts.path != "/robots.txt" or parts.query or parts.fragment:
            raise PackageError("ROBOTS_UNAVAILABLE")
        deadline = time.monotonic() + ROBOTS_TIMEOUT_S
        endpoint = _resolve_public_endpoint(host, deadline)
        connection = _PinnedHTTPSConnection(endpoint, deadline=deadline)
        # HTTPResponse parses headers internally. A total-deadline watchdog closes
        # the active socket even if a server drip-feeds those headers indefinitely.
        watchdog = threading.Timer(_remaining(deadline), connection.cancel)
        watchdog.daemon = True
        watchdog.start()
        connection.request(
            "GET", "/robots.txt", headers={"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
        )
        if connection.sock is not None:
            connection.sock.settimeout(_remaining(deadline))
        response = connection.getresponse()
        status = response.status
        if 400 <= status < 500 and status != 429:
            return None  # no robots.txt; do not read an unneeded error response body
        if status != 200:
            raise PackageError("ROBOTS_UNAVAILABLE")  # never follow any redirect
        if response.getheader("Content-Encoding", "identity").lower().strip() not in ("", "identity"):
            raise PackageError("ROBOTS_UNAVAILABLE")
        body = bytearray()
        while True:
            if connection.sock is not None:
                connection.sock.settimeout(_remaining(deadline))
            else:
                _remaining(deadline)
            # read1 performs at most one underlying buffered read; a server cannot
            # reset the absolute deadline by slowly trickling an entire read(n).
            chunk = response.read1(min(16 * 1024, ROBOTS_MAX_BYTES + 1 - len(body)))
            if not chunk:
                break
            body.extend(chunk)
            if len(body) > ROBOTS_MAX_BYTES:
                raise PackageError("ROBOTS_UNAVAILABLE")
        _remaining(deadline)
        return bytes(body).decode("utf-8-sig", "replace")
    except (PackageError, http.client.HTTPException, TimeoutError, OSError, ValueError):
        raise PackageError("ROBOTS_UNAVAILABLE") from None
    finally:
        if watchdog is not None:
            watchdog.cancel()
        if connection is not None:
            connection.close()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def _comparable(url: str) -> tuple[str, str, int | None, str, str, str]:
    """Normalise trivial browser URL spelling while retaining exact SPA identity."""
    try:
        check_url(url)
    except PackageError:
        raise PackageError("REDIRECT_NOT_ALLOWED") from None
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
        parts.path or "/",
        parts.query,
        parts.fragment,
    )


def same_document(requested: str, final: str) -> bool:
    return _comparable(requested) == _comparable(final)


def _playwright_renderer(url: str, *, user_agent: str, timeout_ms: int, max_bytes: int) -> dict:
    if not os.environ.get("TRAVEL_RELIABILITY_RENDERER_IMAGE"):
        raise PackageError("NETWORK_RENDERER_UNAVAILABLE")
    from .render_sandbox import render_isolated

    return render_isolated(url, user_agent=user_agent, timeout_ms=timeout_ms, max_bytes=max_bytes)


def fetch_rendered(
    url: str,
    *,
    observed_at: str,
    allow_network: bool,
    renderer: Renderer | None = None,
    robots_fetcher: RobotsFetcher | None = None,
) -> dict:
    """Render through a provisioned sandbox or validate a fixture, preserving provenance."""
    if allow_network is not True:
        raise PackageError("NETWORK_NOT_ALLOWED")
    url, host = _check_target(url)
    check_observed_at(observed_at)
    automatic = renderer is None and robots_fetcher is None
    if automatic:
        if not os.environ.get("TRAVEL_RELIABILITY_RENDERER_IMAGE"):
            raise PackageError("NETWORK_RENDERER_UNAVAILABLE")
        try:
            rendered = _playwright_renderer(
                url, user_agent=USER_AGENT, timeout_ms=RENDER_TIMEOUT_MS, max_bytes=MAX_HTML_BYTES
            )
        except PackageError:
            raise
        except Exception:
            raise PackageError("RENDER_FAILED") from None
    elif renderer is None or robots_fetcher is None:
        # A partial fixture must never fall back to real I/O.
        raise PackageError("NETWORK_RENDERER_UNAVAILABLE")
    else:
        try:
            robots_text = robots_fetcher(f"https://{host}/robots.txt")
        except PackageError:
            raise
        except Exception:
            raise PackageError("ROBOTS_UNAVAILABLE") from None
        check_robots(robots_text, url)
        try:
            rendered = renderer(
                url, user_agent=USER_AGENT, timeout_ms=RENDER_TIMEOUT_MS, max_bytes=MAX_HTML_BYTES
            )
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
    result = {"html": html, "retrieval": "rendered_dom" if automatic else "fixture", "url": url}
    if automatic:
        isolation, provenance = rendered.get("isolation"), rendered.get("provenance")
        if not isinstance(isolation, dict) or not isinstance(provenance, dict):
            raise PackageError("RENDER_PROVENANCE_MISSING")
        result.update({"isolation": isolation, "provenance": provenance})
    return result
