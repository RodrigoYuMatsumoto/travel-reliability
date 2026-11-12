"""Publish scanner metadata, never snippets, raw diagnostics or scanned document values."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re


def source_path(value: str) -> str:
    path = PurePosixPath(value.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in {"api", "agent", "web", "ingest", "scripts"}:
        raise ValueError("OUT_OF_SCOPE_SOURCE_PATH")
    return str(path)


def validated_triage(raw: dict, root: Path) -> list:
    if not isinstance(raw, dict) or raw.get("format") != "travel-reliability-sast-triage/1" or not isinstance(raw.get("findings"), list):
        raise ValueError("INVALID_SAST_TRIAGE")
    entries, keys = [], set()
    for entry in raw["findings"]:
        if not isinstance(entry, dict):
            raise ValueError("INVALID_SAST_TRIAGE")
        path = source_path(entry["path"])
        key = (entry["ruleId"], path, entry["line"])
        if key in keys or not isinstance(entry["line"], int) or entry["line"] < 1 or not re.fullmatch(r"[0-9a-f]{64}", entry["sourceSha256"]):
            raise ValueError("INVALID_SAST_TRIAGE")
        if entry.get("disposition") != "not_exploitable_in_reviewed_scope" or not entry.get("reasonCode") or not entry.get("evidence") or not entry.get("tests"):
            raise ValueError("INCOMPLETE_SAST_TRIAGE")
        resolved_root = root.resolve()
        target = (resolved_root / path).resolve()
        if not target.is_relative_to(resolved_root) or target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != entry["sourceSha256"]:
            raise ValueError("SAST_TRIAGE_SOURCE_CHANGED")
        entries.append(entry)
        keys.add(key)
    return entries


def summarize(kind: str, raw: dict, triage: list | None = None) -> dict:
    if not isinstance(raw, dict):
        raise ValueError("INVALID_SCANNER_REPORT")
    if kind == "semgrep":
        scanned = raw.get("paths", {}).get("scanned", [])
        errors = raw.get("errors")
        results = raw.get("results")
        if not isinstance(scanned, list) or not scanned or not isinstance(errors, list) or not isinstance(results, list):
            raise ValueError("INVALID_SEMGREP_REPORT")
        findings = [{"ruleId": str(item["check_id"])[:500], "severity": str(item.get("extra", {}).get("severity", "unknown"))[:20], "path": source_path(item["path"]), "line": int(item.get("start", {}).get("line", 0))} for item in results]
        triaged, remaining = [], []
        for finding in findings:
            match = next((entry for entry in (triage or []) if (entry["ruleId"], entry["path"], entry["line"]) == (finding["ruleId"], finding["path"], finding["line"])), None)
            if match:
                triaged.append({**finding, "disposition": match["disposition"], "reasonCode": match["reasonCode"], "sourceSha256": match["sourceSha256"], "tests": match["tests"]})
            else:
                remaining.append(finding)
        return {"status": "FAIL" if remaining or errors else "PASS", "tool": "Semgrep CE", "version": str(raw.get("version", "unknown"))[:40], "files": len(scanned), "parserOrToolErrors": len(errors), "rawFindings": len(findings), "findings": remaining, "triagedFindings": triaged, "rulesets": ["p/security-audit", "p/owasp-top-ten"], "privacy": "Local scan, metrics disabled; no source snippets or raw diagnostics in this summary."}
    if kind == "bandit":
        metrics = raw.get("metrics", {}).get("_totals", {})
        results = raw.get("results")
        errors = raw.get("errors")
        if not metrics or not isinstance(results, list) or not isinstance(errors, list):
            raise ValueError("INVALID_BANDIT_REPORT")
        findings = [{"ruleId": str(item["test_id"])[:80], "severity": str(item.get("issue_severity", "unknown"))[:20], "confidence": str(item.get("issue_confidence", "unknown"))[:20], "path": source_path(item["filename"]), "line": int(item.get("line_number", 0))} for item in results]
        return {"status": "FAIL" if findings or errors else "PASS", "tool": "Bandit", "version": "1.9.4", "lines": metrics.get("loc", 0), "parserOrToolErrors": len(errors), "findings": findings, "inlineTriage": "Triagem inline restrita aos locais justificados no código: diretórios temporários isolados e comandos Docker fixos, sem shell e com imagem imutável; nenhuma exclusão global de regras.", "privacy": "Only rule metadata, relative source paths and counters."}
    raise ValueError("UNKNOWN_SCANNER")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["semgrep", "bandit"])
    parser.add_argument("raw", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--triage", type=Path)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--rules-lock", type=Path)
    args = parser.parse_args()
    try:
        if args.raw.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("REPORT_LIMIT")
        triage = None
        if args.triage:
            if args.kind != "semgrep" or args.triage.stat().st_size > 64 * 1024:
                raise ValueError("INVALID_SAST_TRIAGE")
            triage = validated_triage(json.loads(args.triage.read_text(encoding="utf-8-sig")), args.source_root)
        report = summarize(args.kind, json.loads(args.raw.read_text(encoding="utf-8-sig")), triage)
        report["rawReportSha256"] = hashlib.sha256(args.raw.read_bytes()).hexdigest()
        if args.triage:
            report["triageSha256"] = hashlib.sha256(args.triage.read_bytes()).hexdigest()
        if args.rules_lock:
            if args.kind != "semgrep" or args.rules_lock.stat().st_size > 64 * 1024:
                raise ValueError("INVALID_RULESET_LOCK")
            lock = json.loads(args.rules_lock.read_text(encoding="utf-8-sig"))
            if lock.get("format") not in {"travel-reliability-semgrep-rules-lock/1", "travel-reliability-semgrep-rules-lock/2"} or lock.get("engine") != report["version"]:
                raise ValueError("RULESET_ENGINE_MISMATCH")
            configs = lock["configs"]
            if {item["id"] for item in configs} != {"p/security-audit", "p/owasp-top-ten"} or len(configs) != 2 or any(not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) for item in configs):
                raise ValueError("INVALID_RULESET_LOCK")
            report["rulesLockSha256"] = hashlib.sha256(args.rules_lock.read_bytes()).hexdigest()
            report["ruleSources"] = [{"id": item["id"], "sha256": item["sha256"], "bytes": item["bytes"]} for item in configs]
    except (OSError, ValueError, TypeError, KeyError, AttributeError, RecursionError):
        report = {"status": "INCOMPLETE", "tool": args.kind, "error": "SCANNER_REPORT_INVALID"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "tool": report["tool"], "findings": len(report.get("findings", [])), "rawFindings": report.get("rawFindings"), "triagedFindings": len(report.get("triagedFindings", [])), "parserOrToolErrors": report.get("parserOrToolErrors")}))
    return 0 if report["status"] == "PASS" else 1 if report["status"] == "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
