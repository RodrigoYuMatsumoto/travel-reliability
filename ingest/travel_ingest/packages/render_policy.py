"""Compiled read-only resource policy; page requests never grant network authority."""
from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlsplit, urlunsplit

from bs4 import BeautifulSoup

from .errors import PackageError
from .fetch import _check_target

PROTOCOL = "travel-reliability-renderer/1"
AUGUSTUS_BACKEND = "https://qajaktvnfbltjfxzpqcm.supabase.co"
AUGUSTUS_LIBRARY = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"
AUGUSTUS_PACKAGES = AUGUSTUS_BACKEND + "/rest/v1/site_kv?key=eq.packages&select=value"
AUGUSTUS_VERSION = AUGUSTUS_BACKEND + "/rest/v1/site_kv?key=eq.packages_seed_version&select=value"
_ASSET_PATH = re.compile(r"(?:/assets/[A-Za-z0-9_-]+-[A-Za-z0-9_-]{8,}\.js|/static/js/[A-Za-z0-9_.-]+\.[a-f0-9]{8,}\.js)")


def network_url(url: str) -> str:
    """Strip only fragments, which never belong to an HTTP request."""
    if not isinstance(url, str) or len(url) > 2048 or not re.fullmatch(r"[\x21-\x7e]+", url):
        raise PackageError("RENDER_RESOURCE_DENIED")
    try:
        part = urlsplit(url)
        if (part.scheme != "https" or not part.hostname or part.username is not None
                or part.password is not None or part.port not in (None, 443)
                or part.hostname.endswith(".") or "\\" in url):
            raise ValueError
    except ValueError:
        raise PackageError("RENDER_RESOURCE_DENIED") from None
    return urlunsplit((part.scheme, part.netloc, part.path or "/", part.query, ""))


@dataclass
class RenderPolicy:
    target: str
    resources: dict[str, str] = field(default_factory=dict)
    required: set[str] = field(default_factory=set)
    _publisher_credential: str | None = field(default=None, repr=False)

    def __post_init__(self):
        self.target, host = _check_target(self.target)
        part = urlsplit(self.target)
        # Authentication, administrative routes and arbitrary paths are outside scope.
        if host.endswith("augustusturismo.com.br"):
            if part.path != "/" or part.query or not re.fullmatch(r"(?:#?/)?(?:pacote/[a-z0-9-]+)?", part.fragment):
                raise PackageError("RENDER_TARGET_DENIED")
            self.resources[AUGUSTUS_LIBRARY] = "script"
            self.resources[AUGUSTUS_PACKAGES] = "json"
            self.resources[AUGUSTUS_VERSION] = "json"
            self.required.add(AUGUSTUS_PACKAGES)
        elif host.endswith("atrativatur.com.br"):
            if (part.fragment or part.path != "/viagem.php"
                    or not re.fullmatch(r"(?:v=\d{1,10}|local=&data=[0-9%/]+)", part.query)):
                raise PackageError("RENDER_TARGET_DENIED")
        elif host == "nielturismo.suareservaonline.com.br":
            if not re.fullmatch(r"/(?:pacote/[a-z0-9-]+/)?44051/?", part.path):
                raise PackageError("RENDER_TARGET_DENIED")
            if part.fragment or (part.query and (part.path.startswith("/pacote/") or not re.fullmatch(
                    r"mes=(?:[1-9]|1[0-2])&destino=&category=&embarque=\d{1,6}", part.query))):
                raise PackageError("RENDER_TARGET_DENIED")
        elif host.endswith("viajantesdovalle.com.br"):
            if not (part.path == "/home" or (part.path.startswith("/home/") and re.search(r"-p\d+$", part.path))):
                raise PackageError("RENDER_TARGET_DENIED")
            if (part.fragment or (part.query and (part.path != "/home" or not re.fullmatch(
                    r"offset=\d{1,4}&limit=\d{1,2}", part.query)))):
                raise PackageError("RENDER_TARGET_DENIED")
        if len(self.resources) > 32:
            raise PackageError("RENDER_RESOURCE_LIMIT")
        self.resources[network_url(self.target)] = "document"

    def authorize(self, url: str, method: str, kind: str, navigation: bool) -> str:
        clean = network_url(url)
        expected = self.resources.get(clean)
        if method not in ("GET", "OPTIONS") or expected is None:
            raise PackageError("RENDER_RESOURCE_DENIED")
        if method == "OPTIONS" and expected != "json":
            raise PackageError("RENDER_RESOURCE_DENIED")
        if navigation and (expected != "document" or clean != network_url(self.target)):
            raise PackageError("RENDER_RESOURCE_DENIED")
        if kind not in {"document", "script", "fetch", "xhr"}:
            raise PackageError("RENDER_RESOURCE_DENIED")
        if (expected == "document") != (kind == "document"):
            raise PackageError("RENDER_RESOURCE_DENIED")
        return clean

    def bind_document(self, html: str) -> None:
        """Only main-document literals can expand same-origin script resources."""
        origin = urlsplit(self.target)
        soup = BeautifulSoup(html, "html.parser")
        for element in soup.find_all("script", src=True):
            raw = element.get("src")
            if not isinstance(raw, str):
                continue
            candidate = urljoin(self.target, raw)
            try:
                candidate = network_url(candidate)
            except PackageError:
                continue
            part = urlsplit(candidate)
            if (AUGUSTUS_PACKAGES not in self.required
                    and (part.scheme, part.netloc) == (origin.scheme, origin.netloc) and not part.query
                    and _ASSET_PATH.fullmatch(part.path) and not any(
                        item in part.path.lower().split("/") for item in ("admin", "api", "auth"))
                    and all(item not in {".", ".."} for item in part.path.split("/"))):
                self.resources[candidate] = "script"
        if len(self.resources) > 32:
            raise PackageError("RENDER_RESOURCE_LIMIT")
        if AUGUSTUS_PACKAGES in self.required:
            found = re.search(r"const\s+SUPABASE_URL\s*=\s*['\"]([^'\"]+)['\"]", html)
            anonymous_key_match = re.search(r"const\s+SUPABASE_ANON_KEY\s*=\s*['\"]([A-Za-z0-9_.-]{40,2000})['\"]", html)
            if found is None or found[1] != AUGUSTUS_BACKEND or anonymous_key_match is None:
                raise PackageError("RENDER_PUBLIC_DATA_UNAVAILABLE")
            try:
                pieces = anonymous_key_match[1].split(".")
                if len(pieces) != 3:
                    raise ValueError
                payload = json.loads(base64.urlsafe_b64decode(pieces[1] + "=" * (-len(pieces[1]) % 4)))
                if payload.get("role") != "anon" or payload.get("ref") != urlsplit(AUGUSTUS_BACKEND).hostname.split(".")[0]:
                    raise ValueError
            except (ValueError, TypeError, KeyError, AttributeError):
                raise PackageError("RENDER_PUBLIC_DATA_UNAVAILABLE") from None
            # Published anonymous visitor token, bound to exact public endpoint only.
            # It is never taken from the browser, environment or operator account.
            self._publisher_credential = anonymous_key_match[1]

    def headers(self, url: str) -> dict[str, str]:
        if url in {AUGUSTUS_PACKAGES, AUGUSTUS_VERSION}:
            if self._publisher_credential is None:
                raise PackageError("RENDER_PUBLIC_DATA_UNAVAILABLE")
            return {"apikey": self._publisher_credential, "Authorization": "Bearer " + self._publisher_credential}
        return {}
