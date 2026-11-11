"""Unprivileged container-only browser worker. There is no network-capable client here."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path

PROTOCOL = "travel-reliability-renderer/1"
MAX_LINE = 8 * 1024 * 1024


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

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True, chromium_sandbox=True,
            args=["--disable-background-networking", "--disable-component-update",
                  "--disable-default-apps", "--disable-sync", "--no-first-run",
                  "--disable-dev-shm-usage", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
            timeout=remaining(),
        )
        context = await browser.new_context(
            accept_downloads=False, service_workers="block", user_agent=config["userAgent"],
            permissions=[], java_script_enabled=True, ignore_https_errors=False,
        )
        context.set_default_timeout(remaining())
        await context.route_web_socket("**/*", lambda websocket: websocket.close())
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
        await page.goto(config["url"], wait_until="domcontentloaded", timeout=remaining())
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
        code = str(error)
        if not (code.startswith("RENDER_") and code.replace("_", "").isalnum() and len(code) <= 80):
            code = "RENDER_BROWSER_FAILED"
        emit({"type": "error", "code": code})
        raise SystemExit(1) from None
