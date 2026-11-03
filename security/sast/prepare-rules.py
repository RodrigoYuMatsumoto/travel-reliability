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
    request = Request(valid_url(url), headers={
        "User-Agent": "travel-reliability-security-rule-lock/1",
        "Accept": "text/yaml",
        "Accept-Encoding": "identity",
    })
    with build_opener(RegistryRedirects()).open(request, timeout=45) as response:
        valid_url(response.url)
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("RULESET_SIZE_LIMIT")
    return data


def validate_lock(lock):
    if not isinstance(lock, dict) or lock.get("format") not in {"travel-reliability-semgrep-rules-lock/1", "travel-reliability-semgrep-rules-lock/2"} or lock.get("engine") != "1.183.0":
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
        if lock["format"].endswith("/2") and (entry.get("normalization") != "whole-rule-order-only/1" or entry.get("orderIndependent") is not True):
            raise ValueError("INVALID_RULESET_LOCK")
    return entries


class RulesetContentDrift(ValueError):
    def __init__(self, entry, data):
        super().__init__("RULESET_CONTENT_DRIFT")
        stripped = data.lstrip()
        kind = ("yaml" if stripped.startswith(b"rules:") else "json" if stripped.startswith((b"{", b"["))
                else "gzip" if data.startswith(b"\x1f\x8b") else "html" if stripped.startswith(b"<") else "other")
        self.diagnostic = {
            "rulesetId": entry["id"], "expectedBytes": entry["bytes"], "observedBytes": len(data),
            "expectedSha256": entry["sha256"], "observedSha256": hashlib.sha256(data).hexdigest(),
            "representation": kind,
        }


def validate_bytes(entry, data):
    try:
        candidate = normalized_rule_order(data) if entry.get("normalization") == "whole-rule-order-only/1" else data
    except ValueError as error:
        raise RulesetContentDrift(entry, data) from error
    if len(data) != entry["bytes"] or hashlib.sha256(candidate).hexdigest() != entry["sha256"] or not data.lstrip().startswith(b"rules:"):
        raise RulesetContentDrift(entry, data)
    return candidate


def normalized_rule_order(data):
    """Only permute complete byte-identical rule blocks. No YAML field is rewritten.

    The digest pins the complete resulting document, including every pattern,
    metadata field, comment and prefix byte. The reviewed lock asserts absence
    of cross-rule YAML anchors; a new byte cannot enter through normalization.
    """
    metadata = rule_block_metadata(data)
    if metadata.get("layout") != "whole-top-level-rule-blocks/1":
        raise ValueError("INVALID_RULESET_DATA")
    starts = [match.start() for match in re.finditer(rb"(?m)^- ", data)]
    blocks = [(row["id"], data[start:starts[index + 1] if index + 1 < len(starts) else len(data)])
              for index, (start, row) in enumerate(zip(starts, metadata["orderedBlocks"]))]
    return data[:starts[0]] + b"".join(block for _, block in sorted(blocks))


def rule_block_metadata(data):
    """Fingerprint whole top-level blocks; never expose their contents."""
    starts = [match.start() for match in re.finditer(rb"(?m)^- ", data)]
    if not starts or len(starts) > 2000 or data[:starts[0]].strip() != b"rules:":
        return {"layout": "unsupported"}
    rows = []
    ids = set()
    for index, start in enumerate(starts):
        block = data[start:starts[index + 1] if index + 1 < len(starts) else len(data)]
        found = re.findall(rb"(?m)^(?:- |  )id: ([A-Za-z0-9_.-]{1,300})\r?$", block)
        if len(found) != 1 or found[0] in ids:
            return {"layout": "unsupported"}
        ids.add(found[0])
        rows.append({"id": found[0].decode("ascii"), "bytes": len(block), "sha256": hashlib.sha256(block).hexdigest()})
    encoded = json.dumps(sorted(rows, key=lambda item: item["id"]), sort_keys=True, separators=(",", ":")).encode()
    return {"layout": "whole-top-level-rule-blocks/1", "rules": len(rows), "uniqueIds": len(ids),
            "prefixSha256": hashlib.sha256(data[:starts[0]]).hexdigest(),
            "unorderedBlocksSha256": hashlib.sha256(encoded).hexdigest(), "orderedBlocks": rows}


def record_drift_metadata(output, entry, data):
    """Keep metadata only; rule bodies may not be redistributed as CI artifacts."""
    if not data.lstrip().startswith(b"rules:") or len(data) > LIMIT:
        return False
    directory = output / "rejected"
    if directory.is_symlink():
        raise ValueError("UNSAFE_RULESET_CACHE")
    directory.mkdir(exist_ok=True, mode=0o700)
    actual = hashlib.sha256(data).hexdigest()
    target = directory / (entry["id"].split("/")[1] + "." + actual + ".metadata.json")
    if target.is_symlink():
        raise ValueError("UNSAFE_RULESET_CACHE")
    report = {"format": "travel-reliability-rule-drift-metadata/1", "rulesetId": entry["id"],
              "rawSha256": actual, "bytes": len(data), **rule_block_metadata(data)}
    encoded = (json.dumps(report, indent=2) + "\n").encode()
    if not target.exists():
        with target.open("xb") as stream:
            stream.write(encoded)
    elif target.read_bytes() != encoded:
        raise ValueError("UNSAFE_RULESET_CACHE")
    return True


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
            original = target.read_bytes()
            data = validate_bytes(entry, original)
            if data == original or check_only:
                continue
        else:
            if check_only:
                raise ValueError("RULESET_CACHE_MISSING")
            data = fetch(entry["url"])
            try:
                data = validate_bytes(entry, data)
            except RulesetContentDrift as error:
                error.diagnostic["driftMetadataStored"] = record_drift_metadata(output, entry, data)
                raise
        handle, temporary = tempfile.mkstemp(prefix=".rules-", dir=output)
        try:
            with os.fdopen(handle, "wb") as stream:
                stream.write(data)
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    return {"status": "PASS", "engine": lock["engine"], "configs": [{"id": item["id"], "sha256": item["sha256"], "bytes": item["bytes"]} for item in entries]}


def failure_diagnostic(error):
    """Expose a bounded failure category, never URLs, payloads or local paths."""
    if isinstance(error, RulesetContentDrift):
        return {"reasonCode": "RULESET_CONTENT_DRIFT", **error.diagnostic}
    if isinstance(error, HTTPError):
        return {"reasonCode": "REGISTRY_HTTP_ERROR", "httpStatus": error.code}
    if isinstance(error, URLError):
        name = type(error.reason).__name__
        known = {"SSLCertVerificationError", "SSLError", "TimeoutError", "ConnectionRefusedError", "ConnectionResetError", "gaierror", "OSError"}
        return {"reasonCode": "REGISTRY_NETWORK_ERROR", "reasonClass": name if name in known else "NetworkError"}
    if isinstance(error, TimeoutError):
        return {"reasonCode": "REGISTRY_TIMEOUT"}
    if isinstance(error, ValueError):
        known = {
            "UNTRUSTED_RULESET_URL", "RULESET_SIZE_LIMIT", "INVALID_RULESET_LOCK",
            "INVALID_RULESET_COVERAGE", "INVALID_RULESET_SOURCE", "INVALID_RULESET_DIGEST",
            "RULESET_CONTENT_DRIFT", "UNSAFE_RULESET_CACHE", "RULESET_CACHE_MISSING",
        }
        code = str(error)
        return {"reasonCode": code if code in known else "INVALID_RULESET_DATA"}
    if isinstance(error, OSError):
        return {"reasonCode": "RULESET_CACHE_IO_ERROR", "errno": error.errno}
    return {"reasonCode": "INVALID_RULESET_DATA"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / ".local/security-audit/rules")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    try:
        lock = json.loads((Path(__file__).parent / "rules-lock.json").read_text(encoding="utf-8"))
        result = prepare(lock, args.output, check_only=args.check_only)
    except (OSError, ValueError, TypeError, KeyError, HTTPError, URLError) as error:
        print(json.dumps({"status": "INCOMPLETE", "error": "RULESET_LOCK_VALIDATION_FAILED", **failure_diagnostic(error)}))
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
