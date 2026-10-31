"""Regression cases for fail-closed, payload-free security report gates."""

import importlib.util
import json
import unittest
from copy import deepcopy
from pathlib import Path


def load_summary(relative_path):
    path = Path(__file__).resolve().parents[1] / relative_path
    spec = importlib.util.spec_from_file_location(relative_path, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


zap = load_summary("dast/summarize-zap.py")
sast = load_summary("sast/summarize.py")


class ZapSummaryTests(unittest.TestCase):
    def setUp(self):
        self.raw = {
            "@version": "2.17.0",
            "site": [{"@name": "http://127.0.0.1:4399", "alerts": []}],
        }
        self.stats = {"totalRequests": 25, "activeRequests": 20, "statuses": {"200": 25}}

    def test_zero_alerts_requires_an_explicit_valid_list(self):
        self.assertEqual(zap.summarize(self.raw, self.stats, 0)["status"], "PASS")

    def test_missing_or_malformed_alerts_are_incomplete(self):
        for value in (None, "invalid", {}):
            with self.subTest(value=value):
                raw = deepcopy(self.raw)
                raw["site"][0]["alerts"] = value
                with self.assertRaises(ValueError):
                    zap.summarize(raw, self.stats, 0)
        del self.raw["site"][0]["alerts"]
        with self.assertRaises(ValueError):
            zap.summarize(self.raw, self.stats, 0)

    def test_active_rule_traffic_is_mandatory(self):
        for stats in ({}, {"activeRequests": 0}, {"activeRequests": "20"}):
            with self.subTest(stats=stats), self.assertRaises(ValueError):
                zap.summarize(self.raw, stats, 0)

    def test_report_target_must_remain_in_scope(self):
        for target in ("https://127.0.0.1:4399", "http://127.0.0.1:4310", "http://example.invalid:4399"):
            with self.subTest(target=target), self.assertRaises(ValueError):
                raw = deepcopy(self.raw)
                raw["site"][0]["@name"] = target
                zap.summarize(raw, self.stats, 0)

    def test_missing_target_or_tool_failure_is_incomplete(self):
        for raw in ({}, {"site": []}):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                zap.summarize(raw, self.stats, 0)
        with self.assertRaises(ValueError):
            zap.summarize(self.raw, self.stats, 1)

    def test_medium_and_high_findings_fail_even_with_low_confidence(self):
        for risk in ("2", "3"):
            with self.subTest(risk=risk):
                raw = deepcopy(self.raw)
                raw["site"][0]["alerts"] = [{
                    "pluginid": "40012", "alert": "Synthetic rule", "riskcode": risk,
                    "confidence": "0", "instances": [],
                }]
                report = zap.summarize(raw, self.stats, 0)
                self.assertEqual(report["status"], "FAIL")
                self.assertEqual(report["blockingAlerts"], 1)

    def test_low_alerts_remain_visible_without_instance_payloads(self):
        self.raw["site"][0]["alerts"] = [{
            "pluginid": "10000", "alert": "Synthetic rule", "riskcode": "1",
            "instances": [{"uri": "synthetic-private-uri", "evidence": "synthetic-private-payload"}],
            "desc": "synthetic-private-description",
        }]
        report = zap.summarize(self.raw, self.stats, 2)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(len(report["alerts"]), 1)
        self.assertNotIn("synthetic-private", json.dumps(report))

    def test_unsupported_configuration_warning_blocks_a_clean_report(self):
        with self.assertRaises(ValueError):
            zap.summarize(self.raw, self.stats, 2, "Unknown parameter: synthetic-option")


class SastSummaryTests(unittest.TestCase):
    def test_missing_or_malformed_results_and_errors_are_incomplete(self):
        reports = {
            "semgrep": {"paths": {"scanned": ["api/src/app.ts"]}, "results": [], "errors": []},
            "bandit": {"metrics": {"_totals": {"loc": 10}}, "results": [], "errors": []},
        }
        for kind, raw in reports.items():
            for field in ("results", "errors"):
                incomplete = deepcopy(raw)
                del incomplete[field]
                with self.subTest(kind=kind, field=field, value="missing"), self.assertRaises(ValueError):
                    sast.summarize(kind, incomplete)
                for value in (None, "invalid", {}):
                    malformed = deepcopy(raw)
                    malformed[field] = value
                    with self.subTest(kind=kind, field=field, value=value), self.assertRaises(ValueError):
                        sast.summarize(kind, malformed)

    def test_complete_clean_reports_pass(self):
        self.assertEqual(sast.summarize("semgrep", {
            "paths": {"scanned": ["api/src/app.ts"]}, "results": [], "errors": [],
        })["status"], "PASS")
        self.assertEqual(sast.summarize("bandit", {
            "metrics": {"_totals": {"loc": 10}}, "results": [], "errors": [],
        })["status"], "PASS")

    def test_reports_without_scanned_source_are_incomplete(self):
        for kind in ("semgrep", "bandit"):
            with self.subTest(kind=kind), self.assertRaises(ValueError):
                sast.summarize(kind, {})

    def test_parser_errors_fail_and_omit_raw_diagnostics(self):
        reports = {
            "semgrep": {"paths": {"scanned": ["api/src/app.ts"]}, "results": [], "errors": ["synthetic-private-diagnostic"]},
            "bandit": {"metrics": {"_totals": {"loc": 10}}, "results": [], "errors": ["synthetic-private-diagnostic"]},
        }
        for kind, raw in reports.items():
            with self.subTest(kind=kind):
                report = sast.summarize(kind, raw)
                self.assertEqual(report["status"], "FAIL")
                self.assertNotIn("synthetic-private", json.dumps(report))

    def test_source_path_projection_rejects_parent_and_absolute_paths(self):
        for path in ("../private.txt", "/private/file.ts", "outside/file.ts"):
            with self.subTest(path=path), self.assertRaises(ValueError):
                sast.source_path(path)


if __name__ == "__main__":
    unittest.main()
