"""Verify v0.3+ catalog-based agent ZIPs without extracting or executing contents."""

import argparse
import hashlib
import json
import posixpath
import re
import stat
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote


def require(condition, code):
    if not condition:
        raise ValueError(code)


def safe_path(value):
    require(isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9_./-]+", value)), "INVALID_ARCHIVE_PATH")
    path = PurePosixPath(value)
    require(not path.is_absolute() and all(part not in (".", "..", "") for part in value.split("/")), "INVALID_ARCHIVE_PATH")
    require(not any(part in ("node_modules", ".git", ".local", ".venv", "artifacts", "__pycache__") or part.startswith(".env") for part in path.parts), "FORBIDDEN_ARCHIVE_PATH")
    return value


def targets(markdown):
    for match in re.finditer(r"\]\((<[^>\r\n]+>|[^\s)]+)([^)]*)\)", markdown):
        yield match.group(1)
    for match in re.finditer(r"^\s{0,3}\[[^\]\r\n]+\]:\s*(<[^>\r\n]+>|[^\s]+)", markdown, re.MULTILINE):
        yield match.group(1)


def validate_archive(archive, expected_commit=None, expected_version=None):
    entries = archive.infolist()
    require(0 < len(entries) <= 500, "ARCHIVE_ENTRY_LIMIT")
    require(sum(entry.file_size for entry in entries) <= 64 * 1024 * 1024, "ARCHIVE_SIZE_LIMIT")
    names = [safe_path(entry.filename) for entry in entries]
    require(len(set(names)) == len(names), "DUPLICATE_ARCHIVE_PATH")
    for entry in entries:
        require(not entry.is_dir() and stat.S_ISREG(entry.external_attr >> 16), "ARCHIVE_REGULAR_FILES_ONLY")
        require(entry.file_size <= 2 * 1024 * 1024 and not entry.flag_bits & 1, "ARCHIVE_ENTRY_LIMIT")
    roots = {name.split("/")[0] for name in names}
    require(len(roots) == 1, "ARCHIVE_ROOT_MISMATCH")
    prefix = next(iter(roots)) + "/"
    require(archive.testzip() is None, "ARCHIVE_CRC_MISMATCH")
    manifest_name = prefix + "PACKAGE-MANIFEST.json"
    require(manifest_name in names, "PACKAGE_MANIFEST_MISSING")
    manifest = json.loads(archive.read(manifest_name).decode("utf-8"))
    require(manifest.get("format") in ("travel-reliability-agent-kit/1", "travel-reliability-skill/1"), "UNKNOWN_PACKAGE_FORMAT")
    require(isinstance(manifest.get("sourceCommit"), str) and bool(re.fullmatch(r"[a-f0-9]{40}", manifest["sourceCommit"])), "INVALID_SOURCE_COMMIT")
    require(isinstance(manifest.get("version"), str) and bool(re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", manifest["version"])), "INVALID_PACKAGE_VERSION")
    if expected_commit is not None:
        require(manifest["sourceCommit"] == expected_commit, "SOURCE_COMMIT_MISMATCH")
    if expected_version is not None:
        require(manifest["version"] == expected_version, "PACKAGE_VERSION_MISMATCH")
    is_skill = manifest["format"] == "travel-reliability-skill/1"
    require(prefix == ("travel-agent/" if is_skill else f"travel-reliability-agent-kit-v{manifest['version']}/"), "ARCHIVE_ROOT_MISMATCH")
    files = manifest.get("files")
    require(isinstance(files, list) and 0 < len(files) <= 499, "INVALID_PACKAGE_INVENTORY")
    expected_names = {manifest_name}
    for entry in files:
        require(isinstance(entry, dict), "INVALID_PACKAGE_INVENTORY")
        path = safe_path(entry.get("path"))
        full = prefix + path
        require(full not in expected_names, "DUPLICATE_INVENTORY_PATH")
        expected_names.add(full)
        require(full in names, "INVENTORY_FILE_MISSING")
        require(isinstance(entry.get("sha256"), str) and bool(re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])), "INVALID_FILE_DIGEST")
        require(hashlib.sha256(archive.read(full)).hexdigest() == entry["sha256"], "FILE_DIGEST_MISMATCH")
        if "sourcePath" in entry:
            safe_path(entry["sourcePath"])
            require(isinstance(entry.get("sourceSha256"), str) and bool(re.fullmatch(r"[a-f0-9]{64}", entry["sourceSha256"])), "INVALID_SOURCE_DIGEST")
    require(set(names) == expected_names, "UNLISTED_ARCHIVE_FILE")
    require(prefix + "LICENSE" in names and prefix + "NOTICE" in names, "LICENSE_FILE_MISSING")
    base = prefix + ("references/" if is_skill else "")
    catalog_path = base + "agents/manifest.json"
    require(catalog_path in names, "BUNDLED_CATALOG_MISSING")
    catalog = json.loads(archive.read(catalog_path).decode("utf-8"))
    require(catalog.get("version") == manifest["version"], "CATALOG_VERSION_MISMATCH")
    agents, commands = catalog.get("agents"), catalog.get("commands")
    require(isinstance(agents, list) and agents and isinstance(commands, list) and commands, "INVALID_BUNDLED_CATALOG")
    for row in agents + commands:
        require(isinstance(row, dict) and base + safe_path(row.get("path")) in names, "CATALOG_FILE_MISSING")
    for path in catalog.get("contracts", {}).values():
        require(base + safe_path(path) in names, "CATALOG_CONTRACT_MISSING")
    counts = {"agents": len(agents), "workflows": len(commands), "calculators": len({row.get("calculatorId") for row in commands if row.get("calculatorId")})}
    require(manifest.get("counts") == counts, "PACKAGE_COUNT_MISMATCH")
    if is_skill:
        require(prefix + "SKILL.md" in names and base + "agent.md" in names, "SKILL_ENTRYPOINT_MISSING")
    checked = 0
    for name in names:
        if not name.endswith(".md"):
            continue
        for raw in targets(archive.read(name).decode("utf-8")):
            target = raw[1:-1] if raw.startswith("<") and raw.endswith(">") else raw
            if re.match(r"^(?:https?:|travel:)", target, re.IGNORECASE) or target.startswith("#"):
                continue
            require(not re.match(r"^[a-z][a-z0-9+.-]*:", target, re.IGNORECASE) and not target.startswith("/"), "UNSUPPORTED_DOCUMENTATION_LINK")
            file = unquote(re.split(r"[?#]", target, maxsplit=1)[0])
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), file))
            require(resolved == prefix.rstrip("/") or resolved.startswith(prefix), "DOCUMENTATION_LINK_ESCAPES_PACKAGE")
            require(resolved in names or any(path.startswith(resolved.rstrip("/") + "/") for path in names), "BROKEN_RELATIVE_FILE_LINK")
            checked += 1
    return {"status": "PASS", "format": manifest["format"], "version": manifest["version"], "sourceCommit": manifest["sourceCommit"], "files": len(names), "counts": counts, "relativeFileLinksChecked": checked, "limits": ["External URLs and fragment anchors were not fetched or semantically validated.", "Manifest integrity is not independent authenticity or proof of anonymization."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archives", nargs="+", type=Path)
    parser.add_argument("--expected-commit")
    parser.add_argument("--expected-version")
    args = parser.parse_args()
    failed = False
    for path in args.archives:
        try:
            require(path.stat().st_size <= 20 * 1024 * 1024, "ARCHIVE_SIZE_LIMIT")
            with zipfile.ZipFile(path) as archive:
                result = validate_archive(archive, args.expected_commit, args.expected_version)
        except (OSError, ValueError, TypeError, KeyError, AttributeError, zipfile.BadZipFile, RuntimeError, UnicodeError):
            result = {"status": "FAIL", "error": "AGENT_ARCHIVE_INVALID", "privacy": "No archive content or raw exception is reflected."}
            failed = True
        print(json.dumps({"artifact": path.name, **result}))
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
