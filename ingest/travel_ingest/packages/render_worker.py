"""Unprivileged container-only browser worker. There is no network-capable client here."""
from __future__ import annotations

import asyncio
import base64
import ctypes
import json
import os
import platform
import sys
import time
from pathlib import Path

PROTOCOL = "travel-reliability-renderer/1"
MAX_LINE = 8 * 1024 * 1024
STAGE = "BOOTSTRAP"


def _supports_clone_probe() -> bool:
    return sys.platform == "linux" and platform.machine() == "x86_64"


def _clone_errno() -> str:
    """Linux x86-64 clone3(NULL, 0) cannot create a child; report only an errno enum."""
    if not _supports_clone_probe():
        return "UNSUPPORTED"
    try:
        library = ctypes.CDLL(None, use_errno=True)
        syscall = library.syscall
        syscall.restype = ctypes.c_long
        syscall.argtypes = [ctypes.c_long, ctypes.c_void_p, ctypes.c_size_t]
        result = syscall(435, None, 0)
        if result != -1:
            return "UNEXPECTED"
        # Linux x86-64 ABI constants; Windows errno.ENOSYS has another value.
        return {1: "EPERM", 38: "ENOSYS", 22: "EINVAL", 14: "EFAULT"}.get(ctypes.get_errno(), "OTHER")
    except Exception:
        return "UNAVAILABLE"


def safe_error_code(error: BaseException) -> str:
    """Classify fixed startup diagnostics without exporting browser logs or URLs."""
    message = str(error)
    if message.startswith("RENDER_") and message.replace("_", "").isalnum() and len(message) <= 80:
        return message
    lowered = message.lower()
    if any(value in lowered for value in ("no usable sandbox", "failed to move to new namespace", "namespace sandbox")):
        return "RENDER_CHROMIUM_SANDBOX_UNAVAILABLE"
    if "pthread_create" in lowered or "can't start new thread" in lowered:
        if STAGE in {"BOOTSTRAP", "PLAYWRIGHT_STARTUP", "BROWSER_LAUNCH"}:
            observed = _clone_errno()
            if observed in {"EPERM", "ENOSYS", "EINVAL", "EFAULT"}:
                return "RENDER_THREAD_CREATION_DENIED_CLONE_" + observed
        return "RENDER_THREAD_CREATION_DENIED"
    if "executable doesn't exist" in lowered:
        return "RENDER_BROWSER_EXECUTABLE_MISSING"
    if "operation not permitted" in lowered or "permission denied" in lowered:
        return "RENDER_PROCESS_PERMISSION_DENIED"
    return "RENDER_" + STAGE + "_FAILED"


def emit(value: dict) -> None:
    raw = json.dumps(value, separators=(",", ":"), ensure_ascii=True).encode("utf-8") + b"\n"
    if len(raw) > MAX_LINE:
        raise ValueError("RENDER_PROTOCOL_LIMIT")
    sys.stdout.buffer.write(raw)
    sys.stdout.buffer.flush()


def read() -> dict:
    raw = sys.stdin.buffer.readline(MAX_LINE + 1)
    if not raw.endswith(b"\n") or len(raw) > MAX_LINE:
        raise ValueError("RENDER_PROTOCOL_INVALID")
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("RENDER_PROTOCOL_INVALID")
    return value


async def main() -> None:
    global STAGE
    from playwright.async_api import async_playwright

    config = read()
    if set(config) != {"protocol", "url", "timeoutMs", "maxBytes", "userAgent"}:
        raise ValueError("RENDER_PROTOCOL_INVALID")
    if config["protocol"] != PROTOCOL or os.getuid() == 0:
        raise ValueError("RENDER_ISOLATION_INVALID")
    interfaces = sorted(item.name for item in Path("/sys/class/net").iterdir())
    if interfaces != ["lo"]:
        raise ValueError("RENDER_ISOLATION_INVALID")
    timeout = config["timeoutMs"]
    maximum = config["maxBytes"]
    if type(timeout) is not int or not 1000 <= timeout <= 60000:
        raise ValueError("RENDER_PROTOCOL_INVALID")
    if type(maximum) is not int or not 1 <= maximum <= 5 * 1024 * 1024:
        raise ValueError("RENDER_PROTOCOL_INVALID")
    deadline = time.monotonic() + timeout / 1000
    lock = asyncio.Lock()
    sequence = 0
    requests = 0
    blocked = 0
    violation = None

    def remaining() -> int:
        value = int((deadline - time.monotonic()) * 1000)
        if value <= 0:
            raise ValueError("RENDER_DEADLINE")
        return value

    STAGE = "PLAYWRIGHT_STARTUP"
    async with async_playwright() as playwright:
        STAGE = "BROWSER_LAUNCH"
        browser = await playwright.chromium.launch(
            headless=True, chromium_sandbox=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-default-apps", "--disable-sync", "--no-first-run",
                  "--disable-dev-shm-usage", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
            timeout=remaining(),
        )
        STAGE = "BROWSER_CONTEXT"
        context = await browser.new_context(
            accept_downloads=False, service_workers="block", user_agent=config["userAgent"],
            permissions=[], java_script_enabled=True, ignore_https_errors=False,
        )
        context.set_default_timeout(remaining())
        await context.route_web_socket("**/*", lambda websocket: websocket.close())
        STAGE = "BROWSER_PAGE"
        page = await context.new_page()

        async def reject_new_page(other):
            nonlocal violation
            if other != page:
                violation = "RENDER_POPUP_DENIED"
                await other.close()

        async def reject_download(download):
            nonlocal violation
            violation = "RENDER_DOWNLOAD_DENIED"
            await download.cancel()

        context.on("page", reject_new_page)
        page.on("download", reject_download)
        page.on("dialog", lambda dialog: dialog.dismiss())

        async def route_request(route):
            nonlocal sequence, requests, blocked
            request = route.request
            if request.method not in {"GET", "OPTIONS"} or request.resource_type not in {"document", "script", "fetch", "xhr"}:
                blocked += 1
                await route.abort("blockedbyclient")
                return
            if request.frame != page.main_frame:
                blocked += 1
                await route.abort("blockedbyclient")
                return
            async with lock:
                requests += 1
                if requests > 48:
                    raise ValueError("RENDER_REQUEST_LIMIT")
                remaining()
                sequence += 1
                identifier = sequence
                emit({"type": "request", "id": identifier, "url": request.url,
                      "method": request.method, "kind": request.resource_type,
                      "navigation": request.is_navigation_request()})
                response = await asyncio.to_thread(read)
                if response.get("id") != identifier:
                    raise ValueError("RENDER_PROTOCOL_INVALID")
                if response.get("blocked") is True:
                    blocked += 1
                    await route.abort("blockedbyclient")
                    return
                if set(response) != {"id", "status", "body", "headers"}:
                    raise ValueError("RENDER_PROTOCOL_INVALID")
                body = base64.b64decode(response["body"], validate=True)
                if len(body) > 2 * 1024 * 1024:
                    raise ValueError("RENDER_PROTOCOL_LIMIT")
                await route.fulfill(status=response["status"], body=body, headers=response["headers"])

        await context.route("**/*", route_request)
        emit({"type": "ready", "protocol": PROTOCOL, "uid": os.getuid(),
              "interfaces": interfaces, "chromiumSandbox": True})
        STAGE = "DOCUMENT_NAVIGATION"
        await page.goto(config["url"], wait_until="domcontentloaded", timeout=remaining())
        STAGE = "DOCUMENT_RENDER"
        await page.wait_for_load_state("networkidle", timeout=remaining())
        if violation is not None:
            raise ValueError(violation)
        html = await page.content()
        if len(html.encode("utf-8")) > maximum:
            raise ValueError("RENDER_HTML_TOO_LARGE")
        emit({"type": "result", "html": html, "finalUrl": page.url,
              "requests": requests, "blocked": blocked})
        await context.close()
        await browser.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except BaseException as error:
        emit({"type": "error", "code": safe_error_code(error)})
        raise SystemExit(1) from None
