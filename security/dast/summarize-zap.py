"""Project a ZAP report to non-sensitive metadata and fail on untriaged medium/high alerts."""

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse


def summarize(raw: dict, stats: dict, tool_exit: int, log: str = "") -> dict:
    if tool_exit not in (0, 2):
        raise ValueError("ZAP_TOOL_FAILED")
    if re.search(r"unknown parameter|unrecognised|unrecognized|unsupported parameter|failed to (?:parse|load|read)|job .+ not found", log, re.IGNORECASE):
        raise ValueError("ZAP_CONFIGURATION_WARNING")
    if not isinstance(stats.get("activeRequests"), int) or stats["activeRequests"] < 1:
        raise ValueError("NO_ACTIVE_REQUESTS_OBSERVED")
    sites = raw.get("site")
    if not isinstance(sites, list) or not sites:
        raise ValueError("ZAP_REPORT_HAS_NO_TARGET")
    findings = []
    for site in sites:
        parsed = urlparse(site.get("@name", ""))
        if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 4399:
            raise ValueError("OUT_OF_SCOPE_TARGET_IN_REPORT")
        alerts = site.get("alerts")
        if not isinstance(alerts, list):
            raise ValueError("INVALID_ZAP_ALERTS")
        for alert in alerts:
            risk = int(alert["riskcode"])
            if risk not in (0, 1, 2, 3):
                raise ValueError("UNKNOWN_ZAP_RISK")
            rule_id = str(alert.get("pluginid", ""))
            if not rule_id.isdigit():
                raise ValueError("INVALID_ZAP_RULE_ID")
            findings.append({
                "ruleId": rule_id,
                "name": str(alert.get("alert", alert.get("name", "")))[:200],
                "risk": ["info", "low", "medium", "high"][risk],
                "riskCode": risk,
                "confidence": str(alert.get("confidence", ""))[:10],
                "instances": len(alert.get("instances", [])),
                "disposition": "requires_correction" if risk >= 2 else "reported_low_or_information",
            })
    blocked = [finding for finding in findings if finding["riskCode"] >= 2]
    return {
        "status": "FAIL" if blocked else "PASS",
        "tool": "OWASP ZAP",
        "toolVersion": str(raw.get("@version", "unknown"))[:40],
        "scope": "bounded unauthenticated active scan of synthetic loopback memory demo",
        "target": "http://127.0.0.1:4399",
        "toolExitCode": tool_exit,
        "recognizedConfigurationWarnings": 0,
        "observedRequests": {
            "total": stats.get("totalRequests", 0),
            "activeRuleRequests": stats["activeRequests"],
            "statuses": {str(key): int(value) for key, value in stats.get("statuses", {}).items() if str(key).isdigit()},
        },
        "alerts": findings,
        "blockingAlerts": len(blocked),
        "privacy": "Only rule metadata and aggregate counters. No cookies, headers, payloads, URLs from instances or response bodies.",
        "limits": [
            "Four-minute active-scan budget, not exhaustive coverage.",
            "Authenticated HTTP/browser cases are executed separately by security/dast/run.ts.",
            "HTTP synthetic target does not assess deployed TLS, live IdP, production stores or provider integrations.",
            "Low/informational alerts remain visible; no medium/high allowlist is applied.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", required=True, type=Path)
    parser.add_argument("--stats", required=True, type=Path)
    parser.add_argument("--log", required=True, type=Path)
    parser.add_argument("--tool-exit", required=True, type=int)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    log = ""
    diagnostics = []
    try:
        if args.raw.stat().st_size > 64 * 1024 * 1024 or args.stats.stat().st_size > 1024 * 1024 or args.log.stat().st_size > 32 * 1024 * 1024:
            raise ValueError("REPORT_LIMIT")
        log = args.log.read_text(encoding="utf-8", errors="replace")
        report = summarize(json.loads(args.raw.read_text(encoding="utf-8-sig")), json.loads(args.stats.read_text(encoding="utf-8-sig")), args.tool_exit, log)
        report["rawReportSha256"] = hashlib.sha256(args.raw.read_bytes()).hexdigest()
    except (OSError, ValueError, TypeError, KeyError, RecursionError):
        report = {"status": "INCOMPLETE", "error": "ZAP_REPORT_OR_EXECUTION_INVALID", "privacy": "Raw input and exception text are deliberately omitted."}
        if not log and args.log.is_file() and args.log.stat().st_size <= 32 * 1024 * 1024:
            log = args.log.read_text(encoding="utf-8", errors="replace")
        for pattern, code in [
            (r"permission denied|AccessDeniedException|ReadOnlyFileSystemException", "ZAP_DIRECTORY_PERMISSION"),
            (r"unknown parameter|unrecognised parameter|unrecognized parameter|unsupported parameter", "ZAP_UNKNOWN_PARAMETER"),
            (r"unrecognised job|unrecognized job|unknown job", "ZAP_UNKNOWN_JOB"),
            (r"UnsupportedClassVersionError", "ZAP_JAVA_VERSION"),
            (r"pull access denied|denied: requested access", "ZAP_IMAGE_PULL_FAILED"),
            (r"unable to access jarfile", "ZAP_LAUNCHER_FILE"),
        ]:
            if re.search(pattern, log, re.IGNORECASE):
                diagnostics.append(code)
        report["diagnosticCodes"] = diagnostics
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "blockingAlerts": report.get("blockingAlerts"), "observedRequests": report.get("observedRequests"), "diagnosticCodes": diagnostics}))
    return 0 if report["status"] == "PASS" else 1 if report["status"] == "FAIL" else 2


if __name__ == "__main__":
    raise SystemExit(main())
