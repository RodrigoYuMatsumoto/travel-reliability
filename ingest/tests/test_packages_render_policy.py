"""Hermetic policy tests: page text cannot create host network authority."""
import base64
import json
import socket
import time

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages.render_broker import ResourceBroker
from travel_ingest.packages.render_policy import (
    AUGUSTUS_BACKEND,
    AUGUSTUS_LIBRARY,
    AUGUSTUS_PACKAGES,
    RenderPolicy,
    network_url,
)

TARGET = "https://augustusturismo.com.br/#/pacote/synthetic-2026-12-30"
ATRATIVA = "https://atrativatur.com.br/viagem.php?v=1"


def public_document(role="anon", reference=None):
    payload = {"role": role, "ref": reference or AUGUSTUS_BACKEND.split("//")[1].split(".")[0]}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    publisher_credential = "syntheticheader." + encoded + ".syntheticsignature"
    html = f"<script>const SUPABASE_URL = '{AUGUSTUS_BACKEND}';const SUPABASE_ANON_KEY = '{publisher_credential}';</script>"
    return html, publisher_credential


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("NETWORK_ATTEMPT_IN_HERMETIC_TEST")
    monkeypatch.setattr(socket, "getaddrinfo", forbidden)
    monkeypatch.setattr(socket, "socket", forbidden)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1/", "https://169.254.169.254/", "file:///private/synthetic",
    "https://example.invalid/synthetic.js", "https://augustusturismo.com.br:444/",
    "https://augustusturismo.com.br./", "wss://augustusturismo.com.br/",
])
def test_browser_requests_never_grant_network_authority(url):
    with pytest.raises(PackageError):
        RenderPolicy(TARGET).authorize(url, "GET", "fetch", False)


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "CONNECT", "HEAD"])
def test_only_get_and_exact_local_preflight_are_accepted(method):
    with pytest.raises(PackageError):
        RenderPolicy(TARGET).authorize(AUGUSTUS_PACKAGES, method, "fetch", False)


@pytest.mark.parametrize("fragment", ["/admin", "/cadastro/synthetic", "/minhas-reservas", "/pacote/other?auth=synthetic"])
def test_authentication_and_administration_are_not_render_targets(fragment):
    with pytest.raises(PackageError):
        RenderPolicy("https://augustusturismo.com.br/#" + fragment)


@pytest.mark.parametrize("url", [
    "https://atrativatur.com.br/viagem.php?local=synthetic-sensitive&data=30%2F12%2F2026",
    "https://atrativatur.com.br/viagem.php?v=1&secret=synthetic",
    "https://nielturismo.suareservaonline.com.br/pacote/synthetic/44051?private=synthetic",
    "https://nielturismo.suareservaonline.com.br/44051?access=synthetic",
    "https://viajantesdovalle.com.br/home?private=synthetic",
    "https://viajantesdovalle.com.br/home/synthetic-p1?private=synthetic",
])
def test_nonpublic_unrecognized_query_parameters_never_reach_network(url):
    with pytest.raises(PackageError, match="RENDER_TARGET_DENIED"):
        RenderPolicy(url)


def test_exact_identity_preserves_fragment_but_network_request_does_not_include_it():
    policy = RenderPolicy(TARGET)
    assert policy.target == TARGET
    assert policy.authorize("https://augustusturismo.com.br/", "GET", "document", True) == network_url(TARGET)
    with pytest.raises(PackageError):
        policy.authorize(AUGUSTUS_PACKAGES, "GET", "document", True)


@pytest.mark.parametrize("source", [
    "/delete.js", "/api/write.js", "/assets/main.js", "/assets/../delete.js",
    "/assets/main-12345678.js?do=delete", "https://example.invalid/assets/main-12345678.js",
])
def test_untrusted_script_src_cannot_authorize_arbitrary_same_origin_get(source):
    policy = RenderPolicy(ATRATIVA)
    policy.bind_document(f'<script src="{source}"></script>')
    assert len(policy.resources) == 1


def test_only_compiled_hashed_asset_roots_can_expand_from_verified_document():
    policy = RenderPolicy(ATRATIVA)
    policy.bind_document('<script src="/assets/main-12345678.js"></script>')
    assert policy.resources["https://atrativatur.com.br/assets/main-12345678.js"] == "script"
    assert policy.headers(ATRATIVA) == {}


def test_augustus_uses_only_compiled_library_and_api_not_arbitrary_script_src():
    policy = RenderPolicy(TARGET)
    html, publisher_credential = public_document()
    policy.bind_document(html + '<script src="/assets/hostile-12345678.js"></script>')
    assert "https://augustusturismo.com.br/assets/hostile-12345678.js" not in policy.resources
    assert policy.headers(AUGUSTUS_PACKAGES)["apikey"] == publisher_credential
    assert policy.headers(AUGUSTUS_LIBRARY) == {}
    assert publisher_credential not in repr(policy)


@pytest.mark.parametrize("role,reference", [("service_role", None), ("authenticated", None), ("anon", "wrongproject")])
def test_only_published_anonymous_token_for_exact_compiled_project_is_eligible(role, reference):
    with pytest.raises(PackageError):
        RenderPolicy(TARGET).bind_document(public_document(role, reference)[0])


@pytest.mark.parametrize("body", [b"[]", b"null", b'[{}]', b'[{"value":null}]', b'[{"value":[]}]',
                                 b'[{"value":"[]"}]', b'[{"value":[{"id":"different","nome":"Synthetic"}]}]'])
def test_http_success_without_matching_published_package_cannot_accept_seed_data(body):
    broker = ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    with pytest.raises(PackageError, match="RENDER_PUBLIC_DATA_UNAVAILABLE"):
        broker._validate_public_packages(body)


def test_nonempty_exact_package_data_may_be_json_or_json_string():
    broker = ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    packages = [{"id": "synthetic-2026-12-30", "nome": "Synthetic fixture"}]
    for value in (packages, json.dumps(packages)):
        broker._validate_public_packages(json.dumps([{"value": value}]).encode())
    with pytest.raises(PackageError):
        broker.require_complete()


def test_preflight_is_synthetic_and_does_not_forward_options_to_network():
    broker = ResourceBroker(RenderPolicy(TARGET), deadline=time.monotonic() + 10)
    response = broker.fetch(AUGUSTUS_PACKAGES, kind="fetch", method="OPTIONS")
    assert response["status"] == 204 and response["body"] == ""
    assert broker.requests == 0 and broker.bytes == 0
    with pytest.raises(PackageError):
        broker.fetch(AUGUSTUS_LIBRARY, kind="script", method="OPTIONS")


def test_repeated_cache_reads_do_not_omit_request_control_or_authorize_other_methods():
    policy = RenderPolicy(ATRATIVA)
    broker = ResourceBroker(policy, deadline=time.monotonic() + 10)
    broker._cache[ATRATIVA] = b"<p>Synthetic</p>", "text/html"
    assert broker.fetch(ATRATIVA, kind="document", navigation=True)["status"] == 200
    with pytest.raises(PackageError):
        broker.fetch(ATRATIVA, kind="document", method="POST", navigation=True)
