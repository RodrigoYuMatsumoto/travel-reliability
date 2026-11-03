"""Exact rule bytes and narrow source-bound triage, without registry requests."""

from copy import deepcopy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


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
            self.assertEqual(list(cache.iterdir()), [])
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
