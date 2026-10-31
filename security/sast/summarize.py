"""Publish scanner metadata, never snippets, raw diagnostics or scanned document values."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath


def source_path(value: str) -> str:
    path = PurePosixPath(value.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] not in {"api", "agent", "web", "ingest", "scripts"}:
        raise ValueError("OUT_OF_SCOPE_SOURCE_PATH")
    return str(path)


def summarize(kind: str, raw: dict) -> dict:
    if kind == "semgrep":
        scanned = raw.get("paths", {}).get("scanned", [])
        errors = raw.get("errors")
        results = raw.get("results")
        if not isinstance(scanned, list) or not scanned or not isinstance(errors, list) or not isinstance(results, list):
            raise ValueError("INVALID_SEMGREP_REPORT")
        findings = [{"ruleId": str(item["check_id"])[:500], "severity": str(item.get("extra", {}).get("severity", "unknown"))[:20], "path": source_path(item["path"]), "line": int(item.get("start", {}).get("line", 0))} for item in results]
        return {"status": "FAIL" if findings or errors else "PASS", "tool": "Semgrep CE", "version": str(raw.get("version", "unknown"))[:40], "files": len(scanned), "parserOrToolErrors": len(errors), "findings": findings, "rulesets": ["p/security-audit", "p/owasp-top-ten"], "privacy": "Local scan, metrics disabled; no source snippets or raw diagnostics in this summary."}
    if kind == "bandit":
        metrics = raw.get("metrics", {}).get("_totals", {})
        results = raw.get("results")
        errors = raw.get("errors")
        if not metrics or not isinstance(results, list) or not isinstance(errors, list):
            raise ValueError("INVALID_BANDIT_REPORT")
        findings = [{"ruleId": str(item["test_id"])[:80], "severity": str(item.get("issue_severity", "unknown"))[:20], "confidence": str(item.get("issue_confidence", "unknown"))[:20], "path": source_path(item["filename"]), "line": int(item.get("line_number", 0))} for item in results]
        return {"status": "FAIL" if findings or errors else "PASS", "tool": "Bandit", "version": "1.9.4", "lines": metrics.get("loc", 0), "parserOrToolErrors": len(errors), "findings": findings, "inlineTriage": "The HOME-only sandbox hint has one narrowly scoped B108 suppression, reviewed with rationale in source; no general rule exclusions.", "privacy": "Only rule metadata, relative source paths and counters."}
    raise ValueError("UNKNOWN_SCANNER")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=["semgrep", "bandit"])
    parser.add_argument("raw", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        if args.raw.stat().st_size > 64 * 1024 * 1024:
            raise ValueError("REPORT_LIMIT")
        report = summarize(args.kind, json.loads(args.raw.read_text(encoding="utf-8-sig")))
        report["rawReportSha256"] = hashlib.sha256(args.raw.read_bytes()).hexdigest()
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        report = {"status": "INCOMPLETE", "tool": args.kind, "error": "SCANNER_REPORT_INVALID"}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "tool": report["tool"], "findings": len(report.get("findings", [])), "parserOrToolErrors": report.get("parserOrToolErrors")}))
    return 0 if report["status"] == "PASS" else 1 if report["status"] == "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
