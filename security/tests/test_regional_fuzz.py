"""Harness negative controls; no supplier network or real documents."""

import importlib.util
import json
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("regional_fuzz_under_test", ROOT / "security/fuzz/regional_packages.py")
FUZZ = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FUZZ)


@unittest.skipUnless(importlib.util.find_spec("bs4"), "Locked ingest dependencies required; the fuzz job runs these controls through uv.")
class RegionalFuzzTests(unittest.TestCase):
    def test_campaign_is_reproducible_and_does_not_log_inputs(self):
        first = FUZZ.run_campaign(20261104, 80, 10)
        second = FUZZ.run_campaign(20261104, 80, 10)
        self.assertEqual(first["status"], "PASS")
        self.assertEqual(first["executedCases"], 80)
        self.assertEqual(first["campaignDigest"], second["campaignDigest"])
        self.assertEqual(first["counts"], second["counts"])
        self.assertEqual(len(first["counts"]), len(FUZZ.RECIPES))
        self.assertEqual(len(first["providerCounts"]), 4)
        encoded = json.dumps(first)
        for forbidden in ("<p>", "sourceUrl", "Synthetic Hotel", FUZZ.PRIVATE_MARKER, "example.invalid"):
            self.assertNotIn(forbidden, encoded)

    def test_broken_extractor_cannot_report_green(self):
        module = FUZZ.extractor_module()
        original = module.parse_package

        def broken(*args, **kwargs):
            result = original(*args, **kwargs)
            result["factsVerified"] = True
            return result

        module.parse_package = broken
        report = FUZZ.run_campaign(20261104, 4, 10, module)
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["failure"]["code"], "FACTS_OVERCLAIM")

    def test_timeout_and_malformed_reports_are_fail_closed(self):
        def timeout(*_args, **_kwargs):
            raise subprocess.TimeoutExpired("synthetic", 1)

        report = FUZZ.run_supervised(1, 4, 1, timeout)
        self.assertEqual(report["failure"]["code"], "WORKER_WALL_DEADLINE")

        class Invalid:
            returncode = 0
            stdout = b"SYNTHETIC_PRIVATE_NOT_JSON"

        rejected = FUZZ.run_supervised(1, 4, 1, lambda *_args, **_kwargs: Invalid())
        self.assertEqual(rejected["status"], "FAIL")
        self.assertNotIn("SYNTHETIC_PRIVATE", json.dumps(rejected))

    def test_real_supervised_process_has_the_same_requested_case_count(self):
        result = FUZZ.run_supervised(20261104, 80, 10)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["executedCases"], 80)
        self.assertEqual(result["accepted"] + result["expectedRejections"], 80)
        self.assertFalse(result["browserExercised"])

    def test_incomplete_green_and_extra_payload_reports_are_rejected(self):
        report = FUZZ.run_campaign(1, 4, 10)
        for mutation in ({"executedCases": 0}, {"payload": "SYNTHETIC_PRIVATE_NOT_FOR_METADATA"}):
            class Altered:
                returncode = 0
                stdout = json.dumps({**report, **mutation}).encode()

            result = FUZZ.run_supervised(1, 4, 1, lambda *_args, **_kwargs: Altered())
            self.assertEqual(result["status"], "FAIL")
            self.assertNotIn("SYNTHETIC_PRIVATE", json.dumps(result))

    def test_accidental_target_output_is_discarded_and_fails_the_case(self):
        module = FUZZ.extractor_module()
        original = module.parse_package

        def noisy(*args, **kwargs):
            print(FUZZ.PRIVATE_MARKER)
            return original(*args, **kwargs)

        module.parse_package = noisy
        report = FUZZ.run_campaign(1, 4, 10, module)
        self.assertEqual(report["status"], "FAIL")
        self.assertEqual(report["failure"]["code"], "PARSER_WROTE_OUTPUT")
        self.assertEqual(report["accepted"] + report["expectedRejections"], report["executedCases"])
        self.assertNotIn(FUZZ.PRIVATE_MARKER, json.dumps(report))


if __name__ == "__main__":
    unittest.main()
