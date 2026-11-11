"""The only network-capable component of isolated rendering: bounded pinned GETs."""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import re
import threading
import time
from urllib.parse import urlsplit

from .errors import PackageError
from .fetch import USER_AGENT, _PinnedHTTPSConnection, _remaining, _resolve_public_endpoint, check_robots
from .render_policy import AUGUSTUS_PACKAGES, RenderPolicy

MAX_REQUESTS = 32
MAX_RESOURCE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 12 * 1024 * 1024
_MIME = {
    "document": {"text/html", "application/xhtml+xml"},
    "script": {"text/javascript", "application/javascript", "application/x-javascript"},
    "json": {"application/json", "text/json", "text/plain"},
    "robots": {"text/plain", "text/html"},
}


class ResourceBroker:
    def __init__(self, policy: RenderPolicy, *, deadline: float):
        self.policy = policy
        self.deadline = deadline
        self.requests = 0
        self.bytes = 0
        self.records: list[dict] = []
        self._robots: dict[str, str | None] = {}
        self._cache: dict[str, tuple[bytes, str]] = {}
        self.succeeded: set[str] = set()
        self.publisher_anonymous_token_used = False

    def _get(self, url: str, kind: str, headers: dict | None = None) -> tuple[bytes, str, int]:
        if self.requests >= MAX_REQUESTS:
            raise PackageError("RENDER_REQUEST_LIMIT")
        self.requests += 1
        _remaining(self.deadline)
        part = urlsplit(url)
        connection = None
        timer = None
        try:
            endpoint = _resolve_public_endpoint(part.hostname, self.deadline)
            connection = _PinnedHTTPSConnection(endpoint, deadline=self.deadline)
            timer = threading.Timer(_remaining(self.deadline), connection.cancel)
            timer.daemon = True
            timer.start()
            outgoing = {"User-Agent": USER_AGENT, "Accept-Encoding": "identity"}
            outgoing.update(headers or {})
            target = (part.path or "/") + ("?" + part.query if part.query else "")
            connection.request("GET", target, headers=outgoing)
            response = connection.getresponse()
            if kind == "robots" and 400 <= response.status < 500 and response.status != 429:
                return b"", "text/plain", response.status
            if response.status != 200:
                raise PackageError("RENDER_HTTP_STATUS_DENIED")
            if response.getheader("Content-Encoding", "identity").strip().lower() not in {"", "identity"}:
                raise PackageError("RENDER_ENCODING_DENIED")
            if "attachment" in response.getheader("Content-Disposition", "").lower():
                raise PackageError("RENDER_DOWNLOAD_DENIED")
            content_type = response.getheader("Content-Type", "")
            if len(content_type) > 200 or any(ord(char) < 32 for char in content_type):
                raise PackageError("RENDER_MIME_DENIED")
            mime = content_type.split(";", 1)[0].strip().lower()
            if mime not in _MIME[kind]:
                raise PackageError("RENDER_MIME_DENIED")
            data = bytearray()
            limit = min(MAX_RESOURCE_BYTES, 512 * 1024 if kind == "robots" else MAX_RESOURCE_BYTES)
            while True:
                _remaining(self.deadline)
                chunk = response.read1(min(16384, limit + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
                self.bytes += len(chunk)
                if len(data) > limit or self.bytes > MAX_TOTAL_BYTES:
                    raise PackageError("RENDER_BYTE_LIMIT")
            _remaining(self.deadline)
            raw = bytes(data)
            self.records.append({"url": url, "kind": kind, "sha256": hashlib.sha256(raw).hexdigest(),
                                 "bytes": len(raw), "status": 200})
            return raw, content_type, response.status
        except PackageError:
            raise
        except (http.client.HTTPException, OSError, TimeoutError, ValueError):
            raise PackageError("RENDER_NETWORK_UNAVAILABLE") from None
        finally:
            if timer is not None:
                timer.cancel()
            if connection is not None:
                connection.close()

    def _check_robots(self, url: str) -> None:
        part = urlsplit(url)
        origin = f"https://{part.netloc}"
        if origin not in self._robots:
            raw, _, status = self._get(origin + "/robots.txt", "robots")
            self._robots[origin] = None if status >= 400 else raw.decode("utf-8-sig", "replace")
        check_robots(self._robots[origin], url)

    def fetch(self, url: str, *, kind: str, method: str = "GET", navigation: bool = False) -> dict:
        clean = self.policy.authorize(url, method, kind, navigation)
        if method == "OPTIONS":
            return {"status": 204, "body": "", "headers": {
                "access-control-allow-origin": "*", "access-control-allow-methods": "GET",
                "access-control-allow-headers": "apikey, authorization, x-client-info"}}
        expected = self.policy.resources[clean]
        if clean not in self._cache:
            self._check_robots(clean)
            raw, mime, _ = self._get(clean, expected, self.policy.headers(clean))
            if clean == AUGUSTUS_PACKAGES:
                self._validate_public_packages(raw)
                self.publisher_anonymous_token_used = True
            if expected == "document":
                try:
                    declared = re.search(r"charset\s*=\s*['\"]?([a-z0-9_-]+)", mime, re.I)
                    selected = declared[1].lower() if declared else "utf-8"
                    encodings = {"utf-8": "utf-8-sig", "utf8": "utf-8-sig", "windows-1252": "cp1252",
                                 "iso-8859-1": "iso-8859-1", "latin1": "iso-8859-1"}
                    if selected not in encodings:
                        raise UnicodeError
                    self.policy.bind_document(raw.decode(encodings[selected]))
                except UnicodeError:
                    raise PackageError("RENDER_DOCUMENT_ENCODING_DENIED") from None
            self._cache[clean] = raw, mime
        raw, mime = self._cache[clean]
        self.succeeded.add(clean)
        return {"status": 200, "body": base64.b64encode(raw).decode("ascii"),
                "headers": {"content-type": mime, "access-control-allow-origin": "*"}}

    def _validate_public_packages(self, raw: bytes) -> None:
        """A successful HTTP response alone cannot authorize an embedded seed fallback."""
        try:
            rows = json.loads(raw)
            if not isinstance(rows, list) or len(rows) != 1 or not isinstance(rows[0], dict) or set(rows[0]) != {"value"}:
                raise ValueError
            packages = rows[0]["value"]
            if isinstance(packages, str):
                packages = json.loads(packages)
            if not isinstance(packages, list) or not 1 <= len(packages) <= 1000:
                raise ValueError
            valid = [package for package in packages if isinstance(package, dict)
                     and isinstance(package.get("id"), str) and 1 <= len(package["id"]) <= 300
                     and isinstance(package.get("nome"), str) and 1 <= len(package["nome"]) <= 300]
            if not valid:
                raise ValueError
            fragment = urlsplit(self.policy.target).fragment
            if fragment.startswith("/pacote/"):
                requested = fragment.removeprefix("/pacote/")
                matches = [package for package in packages if isinstance(package, dict) and package.get("id") == requested]
                if len(matches) != 1 or matches[0] not in valid:
                    raise ValueError
        except (ValueError, KeyError, TypeError, RecursionError, UnicodeError):
            raise PackageError("RENDER_PUBLIC_DATA_UNAVAILABLE") from None

    def require_complete(self) -> None:
        if not self.policy.required.issubset(self.succeeded):
            raise PackageError("RENDER_PUBLIC_DATA_UNAVAILABLE")
        _remaining(self.deadline)

    def receipt(self) -> dict:
        return {"networkRequests": self.requests, "networkBytes": self.bytes,
                "resources": list(self.records), "cookiesForwarded": False,
                "operatorCredentialsUsed": False, "methodsForwarded": ["GET"],
                "publisherAnonymousCredentialUsed": self.publisher_anonymous_token_used,
                "recordedAtMonotonic": time.monotonic()}
