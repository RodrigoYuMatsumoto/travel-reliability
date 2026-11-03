"""Fetch only public rule configuration; reject drift before scanning any source.

Rule bodies remain in the ignored local cache, not in the MIT distribution.
No source, credentials or findings are sent to the registry by this script.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parents[2]
LIMIT = 16 * 1024 * 1024


def valid_url(url):
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.netloc != "semgrep.dev" or not re.fullmatch(r"/c/p/[a-z0-9-]+", parts.path) or parts.query or parts.fragment:
        raise ValueError("UNTRUSTED_RULESET_URL")
    return url


class RegistryRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        valid_url(new_url)
        return super().redirect_request(request, response, code, message, headers, new_url)


def download(url):
    request = Request(valid_url(url), headers={"User-Agent": "travel-reliability-security-rule-lock/1"})
    with build_opener(RegistryRedirects()).open(request, timeout=45) as response:
        valid_url(response.url)
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("RULESET_SIZE_LIMIT")
    return data


def validate_lock(lock):
    if not isinstance(lock, dict) or lock.get("format") != "travel-reliability-semgrep-rules-lock/1" or lock.get("engine") != "1.183.0":
        raise ValueError("INVALID_RULESET_LOCK")
    entries = lock.get("configs")
    if not isinstance(entries, list) or len(entries) != 2 or any(not isinstance(entry, dict) for entry in entries) or {entry.get("id") for entry in entries} != {"p/security-audit", "p/owasp-top-ten"}:
        raise ValueError("INVALID_RULESET_COVERAGE")
    for entry in entries:
        if entry.get("url") != f"https://semgrep.dev/c/{entry['id']}" or entry.get("file") != entry["id"].split("/")[1] + ".yaml":
            raise ValueError("INVALID_RULESET_SOURCE")
        valid_url(entry["url"])
        if not isinstance(entry.get("bytes"), int) or not 0 < entry["bytes"] <= LIMIT or not re.fullmatch(r"[0-9a-f]{64}", str(entry.get("sha256", ""))):
            raise ValueError("INVALID_RULESET_DIGEST")
    return entries


def validate_bytes(entry, data):
    if len(data) != entry["bytes"] or hashlib.sha256(data).hexdigest() != entry["sha256"] or not data.lstrip().startswith(b"rules:"):
        raise ValueError("RULESET_CONTENT_DRIFT")


def prepare(lock, output, fetch=download, check_only=False):
    entries = validate_lock(lock)
    output.mkdir(parents=True, exist_ok=True)
    for entry in entries:
        target = output / entry["file"]
        if target.is_symlink():
            raise ValueError("UNSAFE_RULESET_CACHE")
        if target.exists():
            if target.stat().st_size > LIMIT:
                raise ValueError("RULESET_SIZE_LIMIT")
            validate_bytes(entry, target.read_bytes())
            continue
        if check_only:
            raise ValueError("RULESET_CACHE_MISSING")
        data = fetch(entry["url"])
        validate_bytes(entry, data)
        handle, temporary = tempfile.mkstemp(prefix=".rules-", dir=output)
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(data)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return {"status": "PASS", "engine": lock["engine"], "configs": [{"id": item["id"], "sha256": item["sha256"], "bytes": item["bytes"]} for item in entries]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/security-audit/rules")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        lock = json.loads((Path(__file__).parent / "rules-lock.json").read_text(encoding="utf-8"))
        result = prepare(lock, args.output, check_only=args.check_only)
    except (OSError, ValueError, TypeError, KeyError, HTTPError, URLError):
        print(json.dumps({"status": "INCOMPLETE", "error": "RULESET_LOCK_VALIDATION_FAILED"}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
