"""Host network broker rejects protocol drift, redirects and resource overrun."""
import json
import socket
import time

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages import render_broker as module
from travel_ingest.packages.render_policy import AUGUSTUS_PACKAGES, RenderPolicy

TARGET = "https://atrativatur.com.br/viagem.php?v=1"


class Response:
    def __init__(self, body=b"<p>Synthetic fixture</p>", status=200, headers=None):
        self.body = body
        self.status = status
        self.headers = {"Content-Type": "text/html", **(headers or {})}

    def getheader(self, name, default=None):
        return self.headers.get(name, default)

    def read1(self, size):
        value, self.body = self.body[:size], self.body[size:]
        return value


@pytest.fixture
def connection(monkeypatch):
    calls = []
    state = {"response": Response()}
    class Connection:
        def __init__(self, endpoint, deadline):
            assert endpoint == "SYNTHETIC_PINNED_ENDPOINT"
            assert deadline > time.monotonic()
            self.closed = False

        def request(self, method, target, headers):
            calls.append((method, target, headers))

        def getresponse(self):
            return state["response"]

        def close(self):
            self.closed = True

        def cancel(self):
            self.closed = True

    def forbid(*args, **kwargs):
        raise AssertionError("REAL_NETWORK_NOT_ALLOWED")
    monkeypatch.setattr(socket, "socket", forbid)
    monkeypatch.setattr(socket, "getaddrinfo", forbid)
    monkeypatch.setattr(module, "_resolve_public_endpoint", lambda host, deadline: "SYNTHETIC_PINNED_ENDPOINT")
    monkeypatch.setattr(module, "_PinnedHTTPSConnection", Connection)
    return state, calls


@pytest.mark.parametrize("status", [201, 204, 301, 302, 303, 307, 308, 401, 429, 500])
def test_non_200_resource_response_never_follows_redirect_or_becomes_empty_success(connection, status):
    state, calls = connection
    state["response"] = Response(status=status)
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    with pytest.raises(PackageError, match="RENDER_HTTP_STATUS_DENIED"):
        broker._get(TARGET, "document")
    assert len(calls) == 1 and calls[0][0] == "GET"


@pytest.mark.parametrize("headers,error", [
    ({"Content-Encoding": "gzip"}, "RENDER_ENCODING_DENIED"),
    ({"Content-Encoding": "br"}, "RENDER_ENCODING_DENIED"),
    ({"Content-Disposition": "attachment; filename=synthetic.txt"}, "RENDER_DOWNLOAD_DENIED"),
    ({"Content-Type": "application/octet-stream"}, "RENDER_MIME_DENIED"),
    ({"Content-Type": "application/javascript"}, "RENDER_MIME_DENIED"),
])
def test_encoded_download_and_wrong_mime_resources_are_not_delivered(connection, headers, error):
    state, _ = connection
    state["response"] = Response(headers=headers)
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    with pytest.raises(PackageError, match=error):
        broker._get(TARGET, "document")


def test_response_bytes_include_robots_and_all_resources_in_one_total_budget(connection, monkeypatch):
    state, _ = connection
    monkeypatch.setattr(module, "MAX_TOTAL_BYTES", 10)
    state["response"] = Response(body=b"01234567890")
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    with pytest.raises(PackageError, match="RENDER_BYTE_LIMIT"):
        broker._get(TARGET, "document")


def test_per_resource_limit_enforced_without_truncating_body_into_usable_html(connection, monkeypatch):
    state, _ = connection
    monkeypatch.setattr(module, "MAX_RESOURCE_BYTES", 5)
    state["response"] = Response(body=b"123456")
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    with pytest.raises(PackageError, match="RENDER_BYTE_LIMIT"):
        broker._get(TARGET, "document")


def test_network_request_limit_does_not_reset_for_each_response(connection, monkeypatch):
    monkeypatch.setattr(module, "MAX_REQUESTS", 1)
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    broker._get(TARGET, "document")
    with pytest.raises(PackageError, match="RENDER_REQUEST_LIMIT"):
        broker._get(TARGET, "document")


def test_forwarded_headers_do_not_include_browser_cookies_environment_credentials_or_arbitrary_headers(connection, monkeypatch):
    _, calls = connection
    monkeypatch.setenv("HTTP_PROXY", "SYNTHETIC_PROXY")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "SYNTHETIC_ONLY")
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    broker._get(TARGET, "document")
    assert set(calls[0][2]) == {"User-Agent", "Accept-Encoding"}
    receipt = broker.receipt()
    assert receipt["cookiesForwarded"] is False and receipt["operatorCredentialsUsed"] is False
    assert "SYNTHETIC_ONLY" not in json.dumps(receipt)


def test_required_package_data_is_validated_before_cache_or_success_flags(connection, monkeypatch):
    state, _ = connection
    state["response"] = Response(body=b"[]", headers={"Content-Type": "application/json"})
    policy = RenderPolicy("https://augustusturismo.com.br/#/pacote/synthetic")
    broker = module.ResourceBroker(policy, deadline=time.monotonic() + 10)
    monkeypatch.setattr(broker, "_check_robots", lambda url: None)
    monkeypatch.setattr(policy, "headers", lambda url: {})
    with pytest.raises(PackageError, match="RENDER_PUBLIC_DATA_UNAVAILABLE"):
        broker.fetch(AUGUSTUS_PACKAGES, kind="fetch")
    assert AUGUSTUS_PACKAGES not in broker._cache
    assert AUGUSTUS_PACKAGES not in broker.succeeded


def test_declared_legacy_charset_is_preserved_for_browser_and_decoded_only_for_policy(connection, monkeypatch):
    state, _ = connection
    html = "<p>Excursão sintética</p>"
    state["response"] = Response(body=html.encode("cp1252"), headers={"Content-Type": "text/html; charset=windows-1252"})
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    monkeypatch.setattr(broker, "_check_robots", lambda url: None)
    seen = []
    monkeypatch.setattr(broker.policy, "bind_document", seen.append)
    response = broker.fetch(TARGET, kind="document", navigation=True)
    assert seen == [html]
    assert response["headers"]["content-type"] == "text/html; charset=windows-1252"


def test_unknown_charset_cannot_silently_reinterpret_observed_document(connection, monkeypatch):
    state, _ = connection
    state["response"] = Response(headers={"Content-Type": "text/html; charset=synthetic-unknown"})
    broker = module.ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    monkeypatch.setattr(broker, "_check_robots", lambda url: None)
    with pytest.raises(PackageError, match="RENDER_DOCUMENT_ENCODING_DENIED"):
        broker.fetch(TARGET, kind="document", navigation=True)
