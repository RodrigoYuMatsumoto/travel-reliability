"""Opt-in diagnostic: empty Chromium bootstrap only, never a page or user input."""
from __future__ import annotations

import copy
import json
import os
import subprocess
import tempfile
import uuid
from pathlib import Path

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages import render_sandbox as sandbox

pytestmark = pytest.mark.skipif(os.environ.get("TRAVEL_RENDERER_DIAGNOSTIC_REQUIRED") != "1",
                                reason="Empty-browser technical startup diagnostic is opt-in")
PROBE = """from playwright.sync_api import sync_playwright
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,chromium_sandbox=True,timeout=10000,args=[
  '--disable-background-networking','--disable-component-update','--disable-default-apps',
  '--disable-sync','--no-first-run','--disable-dev-shm-usage',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
 print('EMPTY_BROWSER_STARTUP_PASS')
 b.close()
"""


def test_empty_browser_bootstrap_with_identical_os_guards_exposes_only_technical_startup_errors():
    image = os.environ.get("TRAVEL_RELIABILITY_RENDERER_IMAGE", "")
    name = "tr-render-" + uuid.uuid4().hex
    environment = sandbox._environment()
    with tempfile.TemporaryDirectory(prefix="tr-render-diagnostic-") as owned:
        Path(owned, "config.json").write_text("{}\n", encoding="utf-8")
        base = [sandbox._docker(), "--host", sandbox._daemon(), "--config", owned]
        command = sandbox.container_arguments(image, name, sandbox._profile())
        command = command[:-1] + ["--entrypoint", "python3", image, "-I", "-B", "-c", PROBE]
        created = False
        try:
            subprocess.run(base + command, env=environment, capture_output=True, check=True, timeout=10, shell=False)
            created = True
            actual = json.loads(subprocess.check_output(base + ["inspect", name], env=environment, timeout=5))[0]
            assert actual["Config"]["Entrypoint"] == ["python3"]
            assert actual["Config"]["Cmd"] == ["-I", "-B", "-c", PROBE]
            # The actual diagnostic entrypoint MUST be refused by production.
            with pytest.raises(PackageError, match="RENDER_CONTAINER_ISOLATION_INVALID"):
                sandbox.validate_container(actual, image)
            # All other effective OS guards must equal the production contract.
            guarded = copy.deepcopy(actual)
            guarded["Config"]["Entrypoint"] = ["python3", "-I", "-B", "/app/render_worker.py"]
            guarded["Config"]["Cmd"] = []
            sandbox.validate_container(guarded, image)
            result = subprocess.run(base + ["start", "--attach", name], env=environment, capture_output=True,
                                    timeout=15, shell=False)
            # No page/context/goto, URL, credential or personal document exists in
            # this probe. Logs contain only immutable-image startup diagnostics.
            print("EMPTY_BROWSER_TECHNICAL_STDOUT")
            print(result.stdout[:65536].decode("utf-8", "replace"))
            print("EMPTY_BROWSER_TECHNICAL_STDERR")
            print(result.stderr[:65536].decode("utf-8", "replace"))
            assert result.returncode == 0, "EMPTY_BROWSER_STARTUP_FAILED_SEE_TECHNICAL_LOG"
            assert b"EMPTY_BROWSER_STARTUP_PASS" in result.stdout
        finally:
            if created:
                subprocess.run(base + ["rm", "--force", name], env=environment, capture_output=True,
                               check=True, timeout=8, shell=False)
