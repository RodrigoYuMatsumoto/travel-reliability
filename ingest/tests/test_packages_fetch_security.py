"""Hermetic security regressions: sockets, DNS and browser launch never reach the network."""

import socket
import ssl
import time

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages import fetch as fetch_module

URL = "https://augustusturismo.com.br/#/pacote/natal-2026-12-24"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"
PUBLIC_IP = "8.8.8.8"  # synthetic resolver answer; no connection is made


def synthetic_credentials_url(host: str, path: str) -> str:
    username = "SYNTHETIC_ONLY"
    return f"https://{username}:{username}" + "@" + host + path


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("real network access attempted")

    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(socket, "socket", refuse)


def error_code(callable_, *args, **kwargs):
    with pytest.raises(PackageError) as caught:
        callable_(*args, **kwargs)
    return caught.value.code


def test_default_and_partial_adapters_fail_before_dns_robots_or_browser(monkeypatch):
    calls = []

    def forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError("adapter must not run")

    monkeypatch.setattr(fetch_module, "_resolve_public_endpoint", forbidden)
    monkeypatch.setattr(fetch_module, "_default_robots_fetcher", forbidden)
    monkeypatch.setattr(fetch_module, "_playwright_renderer", forbidden)
    for adapter in ({}, {"renderer": forbidden}, {"robots_fetcher": forbidden}):
        assert (
            error_code(
                fetch_module.fetch_rendered,
                URL,
                observed_at=OBSERVED_AT,
                allow_network=True,
                **adapter,
            )
            == "NETWORK_RENDERER_UNAVAILABLE"
        )
    assert calls == []


@pytest.mark.parametrize(
    "subrequest",
    [
        {"method": "POST", "url": "http://127.0.0.1:4310/synthetic-write"},
        {"method": "PUT", "url": "https://augustusturismo.com.br/synthetic-write"},
        {"method": "DELETE", "url": "https://augustusturismo.com.br/synthetic-write"},
        {"method": "GET", "url": "file:///synthetic/private-document"},
        {"method": "GET", "url": "http://169.254.169.254/synthetic"},
        {"method": "GET", "url": "https://example.invalid/synthetic.js"},
        {"method": "GET", "url": "wss://augustusturismo.com.br/synthetic"},
    ],
)
def test_disabled_browser_cannot_continue_or_navigate_hostile_subrequests(monkeypatch, subrequest):
    operations = []

    class FakeRoute:
        request = subrequest

        def continue_(self):
            operations.append("continue")

        def abort(self):
            operations.append("abort")

    class FakePage:
        def goto(self, *args, **kwargs):
            operations.append("navigate")
            FakeRoute().continue_()

    def launch(*args, **kwargs):
        operations.append("launch")
        return FakePage()

    # Even an installed browser adapter would not be imported or launched. No route
    # is continued and navigation cannot begin; this is stronger than aborting later.
    monkeypatch.setattr(fetch_module, "_untrusted_browser_launch", launch, raising=False)
    assert (
        error_code(
            fetch_module._playwright_renderer,
            URL,
            user_agent=fetch_module.USER_AGENT,
            timeout_ms=30_000,
            max_bytes=1024,
        )
        == "NETWORK_RENDERER_UNAVAILABLE"
    )
    assert operations == []


@pytest.mark.parametrize(
    "final_url",
    [
        "https://augustusturismo.com.br/#/pacote/reveillon-2026-12-30",
        "https://augustusturismo.com.br/#/pacotes",
        "https://augustusturismo.com.br/",
        "https://augustusturismo.com.br/#/pacote/natal-2026-12-24?child=1",
        synthetic_credentials_url("augustusturismo.com.br", "/#/pacote/natal-2026-12-24"),
        "file:///synthetic.html",
    ],
)
def test_spa_product_and_final_url_cannot_change(final_url):
    assert (
        error_code(
            fetch_module.fetch_rendered,
            URL,
            observed_at=OBSERVED_AT,
            allow_network=True,
            renderer=lambda url, **kwargs: {"html": "<p>synthetic</p>", "finalUrl": final_url},
            robots_fetcher=lambda url: None,
        )
        == "REDIRECT_NOT_ALLOWED"
    )


def test_synthetic_render_cannot_claim_rendered_network_provenance():
    result = fetch_module.fetch_rendered(
        URL,
        observed_at=OBSERVED_AT,
        allow_network=True,
        renderer=lambda url, **kwargs: {"html": "<p>synthetic</p>", "finalUrl": url},
        robots_fetcher=lambda url: None,
    )
    assert result["retrieval"] == "fixture"


@pytest.mark.parametrize(
    "requested,final_url",
    [
        (
            "https://augustusturismo.com.br/%7Epackage?v=1",
            "https://augustusturismo.com.br/~package?v=1",
        ),
        (
            "https://www.atrativatur.com.br/viagem.php?v=%31",
            "https://www.atrativatur.com.br/viagem.php?v=1",
        ),
    ],
)
def test_product_path_and_query_are_not_rewritten(requested, final_url):
    assert fetch_module.same_document(requested, final_url) is False


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",
        "0.0.0.0",
        "100.64.0.1",
        "192.0.2.1",
        "224.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "fc00::1",
        "fe80::1",
        "ff02::1",
        "2001:db8::1",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "fe80::1%1",
        "not-an-ip",
    ],
)
def test_non_public_ip_addresses_are_refused(address):
    assert fetch_module._public_ip(address) is False


def dns_answer(address, *, ipv6=False):
    family = socket.AF_INET6 if ipv6 else socket.AF_INET
    sockaddr = (address, 443, 0, 0) if ipv6 else (address, 443)
    return family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr


def test_all_dns_answers_must_be_public_before_any_connect(monkeypatch):
    calls = []

    def resolve(*args):
        calls.append(args)
        return [dns_answer(PUBLIC_IP), dns_answer("127.0.0.1")]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    assert (
        error_code(
            fetch_module._default_robots_fetcher,
            "https://augustusturismo.com.br/robots.txt",
        )
        == "ROBOTS_UNAVAILABLE"
    )
    assert len(calls) == 1


def test_dns_is_resolved_once_and_all_public_answers_are_accepted(monkeypatch):
    calls = []

    def resolve(*args):
        calls.append(args)
        return [dns_answer(PUBLIC_IP), dns_answer("2001:4860:4860::8888", ipv6=True)]

    monkeypatch.setattr(socket, "getaddrinfo", resolve)
    endpoint = fetch_module._resolve_public_endpoint("augustusturismo.com.br", time.monotonic() + 1)
    assert endpoint.address == PUBLIC_IP
    assert endpoint.host == "augustusturismo.com.br"
    assert len(calls) == 1


def test_dns_timeout_fails_closed_without_waiting_for_a_worker(monkeypatch):
    class StalledThread:
        def __init__(self, **kwargs):
            pass

        def start(self):
            pass

    monkeypatch.setattr(fetch_module.threading, "Thread", StalledThread)
    assert (
        error_code(
            fetch_module._resolve_public_endpoint,
            "augustusturismo.com.br",
            time.monotonic() + 0.001,
        )
        == "ROBOTS_UNAVAILABLE"
    )


class FakeSocket:
    def __init__(self, peer=PUBLIC_IP):
        self.peer = peer
        self.connections = []
        self.timeouts = []
        self.closed = False
        self.shutdowns = []

    def connect(self, address):
        self.connections.append(address)

    def getpeername(self):
        return self.peer, 443

    def settimeout(self, value):
        self.timeouts.append(value)

    def shutdown(self, how):
        self.shutdowns.append(how)

    def close(self):
        self.closed = True


@pytest.mark.parametrize("ipv6", [False, True])
def test_tcp_uses_pinned_literal_and_tls_uses_original_hostname(monkeypatch, ipv6):
    address = "2001:4860:4860::8888" if ipv6 else PUBLIC_IP
    raw = FakeSocket(address)
    tls_calls = []

    class VerifiedContext:
        check_hostname = True
        verify_mode = ssl.CERT_REQUIRED

        def wrap_socket(self, sock, *, server_hostname):
            tls_calls.append((sock, server_hostname))
            return raw

    monkeypatch.setattr(socket, "socket", lambda *args: raw)
    monkeypatch.setattr(ssl, "create_default_context", VerifiedContext)
    endpoint = fetch_module._PinnedEndpoint(
        "augustusturismo.com.br", address, socket.AF_INET6 if ipv6 else socket.AF_INET
    )
    connection = fetch_module._PinnedHTTPSConnection(endpoint, deadline=time.monotonic() + 1)
    connection.connect()
    assert raw.connections == [(address, 443, 0, 0) if ipv6 else (address, 443)]
    assert tls_calls == [(raw, "augustusturismo.com.br")]
    assert connection._context.check_hostname is True
    assert connection._context.verify_mode == ssl.CERT_REQUIRED
    connection.cancel()
    assert raw.shutdowns == [socket.SHUT_RDWR]
    assert raw.closed is True


def test_production_tls_context_requires_hostname_and_certificate_validation():
    endpoint = fetch_module._PinnedEndpoint("augustusturismo.com.br", PUBLIC_IP, socket.AF_INET)
    connection = fetch_module._PinnedHTTPSConnection(endpoint, deadline=time.monotonic() + 1)
    assert connection._context.check_hostname is True
    assert connection._context.verify_mode == ssl.CERT_REQUIRED


def test_peer_mismatch_is_refused_before_tls(monkeypatch):
    raw = FakeSocket("127.0.0.1")
    monkeypatch.setattr(socket, "socket", lambda *args: raw)
    endpoint = fetch_module._PinnedEndpoint("augustusturismo.com.br", PUBLIC_IP, socket.AF_INET)
    connection = fetch_module._PinnedHTTPSConnection(endpoint, deadline=time.monotonic() + 1)
    with pytest.raises(OSError, match="peer address mismatch"):
        connection.connect()
    assert raw.closed is True


@pytest.mark.parametrize(
    "url",
    [
        "http://augustusturismo.com.br/robots.txt",
        "file:///robots.txt",
        "https://127.0.0.1/robots.txt",
        "https://example.invalid/robots.txt",
        "https://other.suareservaonline.com.br/robots.txt",
        "https://augustusturismo.com.br:8443/robots.txt",
        synthetic_credentials_url("augustusturismo.com.br", "/robots.txt"),
        "https://augustusturismo.com.br/other.txt",
        "https://augustusturismo.com.br/robots.txt?x=1",
        "https://augustusturismo.com.br/robots.txt#other",
    ],
)
def test_robots_refuses_non_exact_origin_resource_before_dns(url):
    assert error_code(fetch_module._default_robots_fetcher, url) == "ROBOTS_UNAVAILABLE"


class SyntheticResponse:
    status = 200

    def __init__(self, body=b"User-agent: *\nAllow: /", *, status=200, encoding="identity"):
        self.status = status
        self.body = body
        self.position = 0
        self.encoding = encoding
        self.read_limits = []

    def getheader(self, name, default=None):
        return self.encoding if name == "Content-Encoding" else default

    def read1(self, limit):
        self.read_limits.append(limit)
        chunk = self.body[self.position : self.position + limit]
        self.position += len(chunk)
        return chunk


def setup_fake_robots(monkeypatch, response):
    operations = []

    class SyntheticConnection:
        sock = None

        def __init__(self, endpoint, *, deadline):
            operations.append(("connect", endpoint))

        def request(self, method, path, headers):
            operations.append((method, path, headers))

        def getresponse(self):
            return response

        def close(self):
            operations.append("close")

        def cancel(self):
            operations.append("cancel")

    monkeypatch.setattr(
        fetch_module,
        "_resolve_public_endpoint",
        lambda host, deadline: fetch_module._PinnedEndpoint(host, PUBLIC_IP, socket.AF_INET),
    )
    monkeypatch.setattr(fetch_module, "_PinnedHTTPSConnection", SyntheticConnection)
    return operations


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308, 429, 500, 503])
def test_robots_redirect_and_error_bodies_are_never_read_or_followed(monkeypatch, status):
    response = SyntheticResponse(status=status)
    operations = setup_fake_robots(monkeypatch, response)
    assert (
        error_code(fetch_module._default_robots_fetcher, "https://augustusturismo.com.br/robots.txt")
        == "ROBOTS_UNAVAILABLE"
    )
    assert response.read_limits == []
    requests = [item for item in operations if isinstance(item, tuple) and item[0] == "GET"]
    assert len(requests) == 1
    assert requests[0][1] == "/robots.txt"


def test_robots_byte_limit_and_get_only_are_enforced(monkeypatch):
    response = SyntheticResponse(b"a" * (fetch_module.ROBOTS_MAX_BYTES + 1))
    operations = setup_fake_robots(monkeypatch, response)
    assert (
        error_code(fetch_module._default_robots_fetcher, "https://augustusturismo.com.br/robots.txt")
        == "ROBOTS_UNAVAILABLE"
    )
    assert response.position == fetch_module.ROBOTS_MAX_BYTES + 1
    assert max(response.read_limits) <= 16 * 1024
    requests = [item for item in operations if isinstance(item, tuple) and item[0] == "GET"]
    assert len(requests) == 1
    assert requests[0][2]["Accept-Encoding"] == "identity"
    assert operations[-1] == "close"


def test_compressed_robots_body_is_not_decompressed_or_read(monkeypatch):
    response = SyntheticResponse(encoding="gzip")
    setup_fake_robots(monkeypatch, response)
    assert (
        error_code(fetch_module._default_robots_fetcher, "https://augustusturismo.com.br/robots.txt")
        == "ROBOTS_UNAVAILABLE"
    )
    assert response.read_limits == []


def test_total_deadline_watchdog_interrupts_a_slow_response(monkeypatch):
    response = SyntheticResponse()
    operations = setup_fake_robots(monkeypatch, response)
    timers = []
    now = time.monotonic()
    monkeypatch.setattr(fetch_module.time, "monotonic", lambda: now)

    class Timer:
        def __init__(self, interval, function):
            self.interval = interval
            self.function = function
            self.cancelled = False
            timers.append(self)

        def start(self):
            monkeypatch.setattr(
                fetch_module.time, "monotonic", lambda: now + fetch_module.ROBOTS_TIMEOUT_S + 1
            )
            self.function()  # deterministic deadline expiry; no waiting and no network

        def cancel(self):
            self.cancelled = True

    monkeypatch.setattr(fetch_module.threading, "Timer", Timer)
    assert (
        error_code(fetch_module._default_robots_fetcher, "https://augustusturismo.com.br/robots.txt")
        == "ROBOTS_UNAVAILABLE"
    )
    assert "cancel" in operations
    assert timers[0].interval <= fetch_module.ROBOTS_TIMEOUT_S
    assert timers[0].cancelled is True
