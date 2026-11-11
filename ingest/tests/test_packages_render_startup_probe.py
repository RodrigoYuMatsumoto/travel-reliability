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
PROBE = """import os, socket, ctypes, platform
from playwright.sync_api import sync_playwright
assert os.geteuid() == 10001
with open('/proc/self/status') as status:
 caps = [line.split(':',1)[1].strip() for line in status if line.startswith(('CapEff:','CapBnd:'))]
assert len(caps) == 2 and all(int(value,16) == 0 for value in caps)
try:
 os.chroot('/')
except PermissionError:
 print('OUTER_CHROOT_DENIED_WITHOUT_CAPABILITIES')
else:
 raise AssertionError('OUTER_CHROOT_MUST_NOT_BE_PRIVILEGED')
for family in (38,40):
 try:
  value=socket.socket(family,socket.SOCK_STREAM)
 except PermissionError as error:
  assert error.errno == 1
 else:
  value.close()
  raise AssertionError('NON_NAMESPACED_SOCKET_FAMILY_MUST_BE_DENIED')
print('NON_NAMESPACED_SOCKET_FAMILIES_DENIED')
assert platform.machine() == 'x86_64'
assert ctypes.sizeof(ctypes.c_void_p) == 8
library=ctypes.CDLL(None,use_errno=True)
library.syscall.restype=ctypes.c_long
library.syscall.argtypes=[ctypes.c_long,ctypes.c_uint,ctypes.c_void_p]
result=library.syscall(425,0,None)
observed_errno=ctypes.get_errno()
print('IO_URING_SETUP_RESULT',result,'ERRNO',observed_errno,'POINTER_BITS',ctypes.sizeof(ctypes.c_void_p)*8)
print('SOCKETCALL_32BIT_NOT_EXECUTED_ON_AMD64')
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,chromium_sandbox=True,timeout=10000,args=[
  '--disable-background-networking','--disable-component-update','--disable-default-apps',
  '--disable-sync','--no-first-run','--disable-dev-shm-usage',
  '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
 print('EMPTY_BROWSER_STARTUP_PASS')
 b.close()
assert result == -1 and observed_errno == 1, 'IO_URING_SETUP_MUST_BE_DENIED'
print('IO_URING_SETUP_DENIED')
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
