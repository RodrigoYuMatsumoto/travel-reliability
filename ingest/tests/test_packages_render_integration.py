"""Real Docker/Chromium tests, synthetic pages only, no provider network access.

CI sets TRAVEL_RENDERER_INTEGRATION_REQUIRED=1 and a locally-built immutable image
ID. A requested homologation cannot silently skip if the daemon/browser is absent.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import socket
import subprocess
import threading
import time

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages import render_sandbox as sandbox
from travel_ingest.packages.render_broker import ResourceBroker
from travel_ingest.packages.render_policy import AUGUSTUS_PACKAGES, RenderPolicy

REQUIRED = os.environ.get("TRAVEL_RENDERER_INTEGRATION_REQUIRED") == "1"
IMAGE = os.environ.get("TRAVEL_RELIABILITY_RENDERER_IMAGE", "")
pytestmark = pytest.mark.skipif(not REQUIRED, reason="Real Docker/Chromium homologation requires explicit CI opt-in")
TARGET = "https://augustusturismo.com.br/#/pacote/synthetic-2026-12-30"
STATIC_TARGET = "https://atrativatur.com.br/viagem.php?v=1"


class MemoryBroker(ResourceBroker):
    def __init__(self, policy, html, seconds=30):
        super().__init__(policy, deadline=time.monotonic() + seconds)
        self.html = html
        self.calls = []
        self.on_document = None

    def fetch(self, url, *, kind, method="GET", navigation=False):
        clean = self.policy.authorize(url, method, kind, navigation)
        self.calls.append((clean, method))
        if self.on_document is not None and kind == "document":
            self.on_document()
            self.on_document = None
        if clean == AUGUSTUS_PACKAGES:
            raw = json.dumps([{"value": [{"id": "synthetic-2026-12-30", "nome": "Synthetic fixture"}]}]).encode()
            self._validate_public_packages(raw)
            mime = "application/json"
        elif kind == "document":
            raw, mime = self.html.encode(), "text/html"
        else:
            raise PackageError("RENDER_RESOURCE_DENIED")
        self.succeeded.add(clean)
        return {"status": 200, "body": base64.b64encode(raw).decode(),
                "headers": {"content-type": mime, "access-control-allow-origin": "*"}}


def assert_available():
    assert shutil.which("docker"), "DOCKER_REQUIRED_FOR_RENDERER_HOMOLOGATION"
    assert IMAGE.startswith("sha256:"), "IMMUTABLE_IMAGE_REQUIRED_FOR_RENDERER_HOMOLOGATION"


def test_real_browser_renders_spa_but_cannot_reach_host_canary_even_without_route_interception(monkeypatch):
    assert_available()
    html = """<!doctype html><html><body><main id="result">WAITING</main><script>
    for (const method of ['POST','PUT','PATCH','DELETE']) fetch(location.href,{method}).catch(()=>{});
    for (const url of ['http://127.0.0.1:4310/synthetic','http://169.254.169.254/synthetic',
      'https://example.invalid/synthetic','file:///synthetic-private','https://augustusturismo.com.br/admin.js'])
      fetch(url).catch(()=>{});
    try { new WebSocket('wss://example.invalid/synthetic'); } catch {}
    navigator.serviceWorker.register('/synthetic-service-worker.js').catch(()=>{});
    fetch('""" + AUGUSTUS_PACKAGES + """').then(r=>r.json()).then(v=>{
      document.getElementById('result').textContent='RENDERED-SYNTHETIC-'+v[0].value[0].id;
    });</script></body></html>"""
    broker = MemoryBroker(RenderPolicy(TARGET), html)
    started = {}
    original_popen = sandbox.subprocess.Popen

    def observe_command(command, *args, **kwargs):
        if "start" in command and "--attach" in command:
            started["base"] = command[:command.index("start")]
            started["name"] = command[-1]
        return original_popen(command, *args, **kwargs)

    monkeypatch.setattr(sandbox.subprocess, "Popen", observe_command)
    canary_hits = []

    def inspect_raw_egress():
        # This intentionally bypasses every Playwright route. Only the OS network
        # namespace can prevent this trusted test process from reaching the canary.
        base, name = started["base"], started["name"]
        bridge = subprocess.check_output(base + ["network", "inspect", "bridge"], env=sandbox._environment())
        gateway = json.loads(bridge)[0]["IPAM"]["Config"][0]["Gateway"]
        with socket.socket() as listener:
            listener.bind((gateway, 0))
            listener.listen(1)
            listener.settimeout(0.3)
            port = listener.getsockname()[1]
            def watch():
                try:
                    connection, _ = listener.accept()
                    canary_hits.append(True)
                    connection.close()
                except OSError:
                    pass
            watcher = threading.Thread(target=watch, daemon=True)
            watcher.start()
            code = ("import socket; s=socket.socket(); s.settimeout(1); "
                    f"result=s.connect_ex(({gateway!r},{port})); s.close(); "
                    "assert result != 0, 'RAW_EGRESS_REACHED_CANARY'; print('RAW_EGRESS_BLOCKED')")
            output = subprocess.check_output(base + ["exec", name, "python3", "-I", "-c", code],
                                             env=sandbox._environment(), timeout=5)
            assert output.strip() == b"RAW_EGRESS_BLOCKED"
            watcher.join(timeout=1)
            assert canary_hits == []

    broker.on_document = inspect_raw_egress
    result = sandbox.run_isolated(broker.policy, broker, image=IMAGE)
    assert "RENDERED-SYNTHETIC-synthetic-2026-12-30" in result["html"]
    assert result["finalUrl"] == TARGET
    assert result["isolation"]["network"] == "none"
    assert result["isolation"]["chromiumSandbox"] is True
    assert result["isolation"]["blockedBrowserRequests"] >= 4
    assert {method for _, method in broker.calls} == {"GET"}
    assert set(url for url, _ in broker.calls) == {"https://augustusturismo.com.br/", AUGUSTUS_PACKAGES}


def test_real_browser_cannot_change_spa_product_identity():
    assert_available()
    broker = MemoryBroker(RenderPolicy(STATIC_TARGET), "<html><script>history.replaceState({},'', '#other');</script></html>")
    with pytest.raises(PackageError, match="RENDER_RESULT_INVALID"):
        sandbox.run_isolated(broker.policy, broker, image=IMAGE)


def test_real_browser_blob_download_is_rejected():
    assert_available()
    html = """<html><body><script>
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['synthetic']));
      a.download='synthetic.txt';document.body.append(a);a.click();
      </script></body></html>"""
    broker = MemoryBroker(RenderPolicy(STATIC_TARGET), html)
    with pytest.raises(PackageError, match="RENDER_DOWNLOAD_DENIED"):
        sandbox.run_isolated(broker.policy, broker, image=IMAGE)


def test_real_browser_infinite_script_is_killed_with_owned_container_cleanup(monkeypatch):
    assert_available()
    name = {}
    original = sandbox.validate_container
    def observed(value, image):
        name["value"] = value["Name"].removeprefix("/")
        return original(value, image)
    monkeypatch.setattr(sandbox, "validate_container", observed)
    broker = MemoryBroker(RenderPolicy(STATIC_TARGET), "<html><script>while(true){}</script></html>", seconds=10)
    started = time.monotonic()
    with pytest.raises(PackageError):
        sandbox.run_isolated(broker.policy, broker, image=IMAGE, timeout_ms=10000)
    assert time.monotonic() - started < 24
    assert broker.calls, "The test must reach the malicious page, not only time out during setup"
    result = subprocess.run([sandbox._docker(), "--host", sandbox._daemon(), "inspect", name["value"]],
                            env=sandbox._environment(), capture_output=True, timeout=5)
    assert result.returncode != 0
