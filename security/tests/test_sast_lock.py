"""Exact rule bytes and narrow source-bound triage, without registry requests."""

from copy import deepcopy
from contextlib import redirect_stdout
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rules = load("locked_sast_rules", ROOT / "security/sast/prepare-rules.py")
summary = load("source_bound_sast_summary", ROOT / "security/sast/summarize.py")


def fixture_lock():
    data = b"rules:\n- id: synthetic-fixture\n"
    lock = {
        "format": "travel-reliability-semgrep-rules-lock/1", "engine": "1.183.0",
        "configs": [
            {"id": "p/" + name, "url": "https://semgrep.dev/c/p/" + name, "file": name + ".yaml", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
            for name in ("security-audit", "owasp-top-ten")
        ],
    }
    return lock, data


class RulesLockTests(unittest.TestCase):
    def test_committed_lock_preserves_both_existing_packs(self):
        lock = json.loads((ROOT / "security/sast/rules-lock.json").read_text(encoding="utf-8"))
        self.assertEqual(len(rules.validate_lock(lock)), 2)

    def test_cache_reuses_only_verified_bytes_without_network(self):
        lock, data = fixture_lock()
        calls = []
        with tempfile.TemporaryDirectory(prefix="travel-sast-lock-") as temporary:
            cache = Path(temporary)
            report = rules.prepare(lock, cache, lambda url: calls.append(url) or data)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(len(calls), 2)
            rules.prepare(lock, cache, lambda _: self.fail("Verified cache must not fetch"), check_only=True)
            (cache / "security-audit.yaml").write_bytes(data + b"# changed\n")
            with self.assertRaisesRegex(ValueError, "RULESET_CONTENT_DRIFT"):
                rules.prepare(lock, cache, lambda _: self.fail("Corrupt cache must not silently refresh"))

    def test_changed_remote_bytes_and_missing_offline_cache_fail(self):
        lock, _ = fixture_lock()
        with tempfile.TemporaryDirectory(prefix="travel-sast-lock-") as temporary:
            cache = Path(temporary)
            with self.assertRaisesRegex(ValueError, "RULESET_CONTENT_DRIFT"):
                rules.prepare(lock, cache, lambda _: b"rules:\n# changed\n")
            self.assertFalse((cache / "security-audit.yaml").exists())
            rejected = list((cache / "rejected").glob("*.metadata.json"))
            self.assertEqual(len(rejected), 1)
            self.assertNotIn("# changed", rejected[0].read_text())
            with self.assertRaisesRegex(ValueError, "RULESET_CACHE_MISSING"):
                rules.prepare(lock, cache, check_only=True)

    def test_lock_cannot_add_a_host_remove_a_pack_or_escape_cache(self):
        lock, _ = fixture_lock()
        for key, value in (("url", "https://example.invalid/rules"), ("file", "../outside.yaml"), ("sha256", "invalid")):
            invalid = deepcopy(lock)
            invalid["configs"][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                rules.validate_lock(invalid)
        lock["configs"].pop()
        with self.assertRaises(ValueError):
            rules.validate_lock(lock)
        for url in ("http://semgrep.dev/c/p/security-audit", "https://semgrep.dev/c/p/security-audit?token=synthetic", "https://semgrep.dev.example.invalid/c/p/security-audit"):
            with self.subTest(url=url), self.assertRaises(ValueError):
                rules.valid_url(url)

    def test_failure_diagnostics_remain_specific_without_disclosing_values(self):
        marker = "synthetic-private-diagnostic-never-publish"
        cases = [
            (HTTPError("https://example.invalid/" + marker, 403, marker, {}, None), {"reasonCode": "REGISTRY_HTTP_ERROR", "httpStatus": 403}),
            (URLError(ConnectionRefusedError(marker)), {"reasonCode": "REGISTRY_NETWORK_ERROR", "reasonClass": "ConnectionRefusedError"}),
            (URLError(marker), {"reasonCode": "REGISTRY_NETWORK_ERROR", "reasonClass": "NetworkError"}),
            (TimeoutError(marker), {"reasonCode": "REGISTRY_TIMEOUT"}),
            (ValueError("RULESET_CONTENT_DRIFT"), {"reasonCode": "RULESET_CONTENT_DRIFT"}),
            (ValueError("UNTRUSTED_RULESET_URL"), {"reasonCode": "UNTRUSTED_RULESET_URL"}),
            (ValueError(marker), {"reasonCode": "INVALID_RULESET_DATA"}),
            (PermissionError(13, marker, marker), {"reasonCode": "RULESET_CACHE_IO_ERROR", "errno": 13}),
        ]
        for error, expected in cases:
            with self.subTest(reason=expected["reasonCode"]):
                output = io.StringIO()
                with patch("sys.argv", ["prepare-rules.py", "--check-only"]), patch.object(rules, "prepare", side_effect=error), redirect_stdout(output):
                    self.assertEqual(rules.main(), 2)
                report = json.loads(output.getvalue())
                self.assertEqual(report, {"status": "INCOMPLETE", "error": "RULESET_LOCK_VALIDATION_FAILED", **expected})
                self.assertNotIn(marker, output.getvalue())
                self.assertNotIn("https://", output.getvalue())

    def test_drift_diagnostics_identify_bytes_and_representation_without_payload(self):
        lock, _ = fixture_lock()
        for data, representation in [(b'rules:\n# synthetic private value\n', "yaml"), (b'{"synthetic-private":true}', "json"), (b'<html>synthetic private</html>', "html"), (b'\x1f\x8bsynthetic', "gzip")]:
            with self.subTest(representation=representation):
                with self.assertRaises(rules.RulesetContentDrift) as captured:
                    rules.validate_bytes(lock["configs"][0], data)
                report = rules.failure_diagnostic(captured.exception)
                self.assertEqual(report["reasonCode"], "RULESET_CONTENT_DRIFT")
                self.assertEqual(report["rulesetId"], "p/security-audit")
                self.assertEqual(report["observedBytes"], len(data))
                self.assertEqual(report["observedSha256"], hashlib.sha256(data).hexdigest())
                self.assertEqual(report["representation"], representation)
                self.assertNotIn("synthetic", json.dumps(report))

    def test_download_requests_a_fixed_representation_without_weakening_transport(self):
        class Response:
            url = "https://semgrep.dev/c/p/security-audit"
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit):
                self.limit = limit
                return b"rules:\n"
        with patch.object(rules, "build_opener") as opener:
            opener.return_value.open.return_value = Response()
            self.assertEqual(rules.download(Response.url), b"rules:\n")
        request = opener.return_value.open.call_args.args[0]
        self.assertEqual(request.get_header("Accept"), "text/yaml")
        self.assertEqual(request.get_header("Accept-encoding"), "identity")
        self.assertEqual(opener.return_value.open.call_args.kwargs["timeout"], 45)

    def test_drift_metadata_never_contains_rule_bodies_or_becomes_accepted_cache(self):
        lock, data = fixture_lock()
        changed = data + b"# changed public configuration\n"
        with tempfile.TemporaryDirectory(prefix="travel-sast-lock-") as temporary:
            cache = Path(temporary)
            with self.assertRaises(rules.RulesetContentDrift) as captured:
                rules.prepare(lock, cache, lambda _: changed)
            self.assertTrue(captured.exception.diagnostic["driftMetadataStored"])
            self.assertEqual(list(cache.glob("*.yaml")), [])
            records = list((cache / "rejected").glob("*.metadata.json"))
            self.assertEqual(len(records), 1)
            self.assertNotIn("changed public configuration", records[0].read_text())
            with self.assertRaisesRegex(ValueError, "RULESET_CACHE_MISSING"):
                rules.prepare(lock, cache, check_only=True)
            self.assertFalse(rules.record_drift_metadata(cache, lock["configs"][0], b"<html>not a public YAML config</html>"))

    def test_block_fingerprint_preserves_all_bytes_and_handles_ids_after_patterns(self):
        first = b'- id: first-rule\n  message: private body one\n'
        second = b'- patterns:\n  - pattern: "$X"\n  id: second-rule\n  message: private body two\n'
        left = rules.rule_block_metadata(b'rules:\n' + first + second)
        right = rules.rule_block_metadata(b'rules:\n' + second + first)
        self.assertEqual(left["rules"], 2)
        self.assertEqual(left["unorderedBlocksSha256"], right["unorderedBlocksSha256"])
        self.assertNotEqual(left["orderedBlocks"], right["orderedBlocks"])
        changed = rules.rule_block_metadata(b'rules:\n' + first + second.replace(b'body two', b'body NEW'))
        self.assertNotEqual(left["unorderedBlocksSha256"], changed["unorderedBlocksSha256"])
        self.assertNotIn("private body", json.dumps(left))
        self.assertEqual(rules.rule_block_metadata(b'rules:\n'+first+first)["layout"], "unsupported")


class SourceBoundTriageTests(unittest.TestCase):
    def test_only_exact_rule_path_line_and_source_digest_are_triaged(self):
        with tempfile.TemporaryDirectory(prefix="travel-sast-triage-") as temporary:
            root = Path(temporary)
            source = root / "agent/fixture.ts"
            source.parent.mkdir()
            source.write_bytes(b"synthetic reviewed source\n")
            entry = {
                "ruleId": "synthetic.child-process", "path": "agent/fixture.ts", "line": 1,
                "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                "disposition": "not_exploitable_in_reviewed_scope", "reasonCode": "TRUSTED_FIXTURE",
                "evidence": "Synthetic reviewed boundary only.", "tests": ["security/tests/test_sast_lock.py"],
            }
            triage = {"format": "travel-reliability-sast-triage/1", "findings": [entry]}
            entries = summary.validated_triage(triage, root)
            raw = {"paths": {"scanned": ["agent/fixture.ts"]}, "errors": [], "results": [{"check_id": entry["ruleId"], "path": entry["path"], "start": {"line": 1}, "extra": {"severity": "ERROR", "message": "synthetic raw diagnostic"}}]}
            report = summary.summarize("semgrep", raw, entries)
            self.assertEqual(report["status"], "PASS")
            self.assertEqual(report["rawFindings"], 1)
            self.assertEqual(len(report["triagedFindings"]), 1)
            self.assertNotIn("synthetic raw diagnostic", json.dumps(report))
            for field, value in (("check_id", "different.rule"), ("path", "agent/other.ts"), ("start", {"line": 2})):
                changed = deepcopy(raw)
                changed["results"][0][field] = value
                with self.subTest(field=field):
                    self.assertEqual(summary.summarize("semgrep", changed, entries)["status"], "FAIL")
            raw["errors"] = ["synthetic parser error"]
            self.assertEqual(summary.summarize("semgrep", raw, entries)["status"], "FAIL")
            source.write_bytes(b"changed source\n")
            with self.assertRaisesRegex(ValueError, "SAST_TRIAGE_SOURCE_CHANGED"):
                summary.validated_triage(triage, root)


if __name__ == "__main__":
    unittest.main()
