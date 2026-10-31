"""Synthetic in-memory ZIPs; no source/private archive is extracted or executed."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "agent_package_verifier", Path(__file__).resolve().parents[2] / "scripts" / "verify-agent-package.py"
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


def fixture_files():
    ids = ["flex-dates", "airports", "connections", "promotions", "total-cost",
           "fare-scenarios", "negotiation", "hidden-city", "group-split"]
    commands = [
        {"id": value, "path": f"prompts/{index:02d}_{value.replace('-', '_')}.md", "calculatorId": value}
        for index, value in enumerate(ids, 1)
    ]
    catalog = {
        "version": "0.4.0",
        "agents": [{"id": "travel-agent", "path": "agents/TRAVEL_AGENT.md"}],
        "commands": commands,
        "contracts": {},
    }
    files = {
        "LICENSE": b"Synthetic license fixture.\n",
        "NOTICE": b"Synthetic fixture only.\n",
        "README.md": b"[hub](agents/TRAVEL_AGENT.md)\n",
        "agents/TRAVEL_AGENT.md": b"# Synthetic hub\n",
        "LICENSES/Apache-2.0.txt": b"Historical fixture.\n",
        "docs/LICENSING.md": b"[historical](../LICENSES/Apache-2.0.txt)\n",
        "schema/operator-profile.schema.json": b'{"type":"object"}\n',
        "examples/operator-profile.json": b'{"version":1,"workspaceRoot":"C:/SyntheticWorkspace"}\n',
        "docs/OPERATOR_PROFILE.md": b"# Synthetic operator profile\n",
        "docs/UNICODE_EXPORTS.md": b"# Synthetic font configuration\n",
        "agents/manifest.json": json.dumps(catalog).encode(),
    }
    files.update({command["path"]: b"# Synthetic command\n" for command in commands})
    return files


def archive_for(files, unlisted=None, tampered=None, version="0.4.0"):
    catalog = json.loads(files["agents/manifest.json"])
    manifest = {
        "format": "travel-reliability-agent-kit/1",
        "version": version,
        "sourceCommit": "1" * 40,
        "counts": {"agents": len(catalog["agents"]), "workflows": len(catalog["commands"]),
                   "calculators": len({row["calculatorId"] for row in catalog["commands"]})},
        "files": [{"path": path, "sha256": hashlib.sha256(data).hexdigest()} for path, data in files.items()],
    }
    data = io.BytesIO()
    contents = {**files, **(unlisted or {}), **(tampered or {}),
                "PACKAGE-MANIFEST.json": json.dumps(manifest).encode()}
    with zipfile.ZipFile(data, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in contents.items():
            info = zipfile.ZipInfo(f"travel-reliability-agent-kit-v{version}/" + path)
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    data.seek(0)
    return zipfile.ZipFile(data)


class AgentPackageVerifierTests(unittest.TestCase):
    def test_complete_instruction_fixture_and_historical_license(self):
        with archive_for(fixture_files()) as archive:
            result = verifier.validate_archive(archive, "1" * 40, "0.4.0")
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["relativeFileLinksChecked"], 2)
        self.assertTrue(result["manualInstructionsOnly"])

    def test_declared_executor_file_is_rejected(self):
        files = fixture_files()
        files["agent/runtime.mjs"] = b"Synthetic non-executed text.\n"
        with archive_for(files) as archive:
            with self.assertRaisesRegex(ValueError, "EXECUTABLE_OR_UNEXPECTED_PACKAGE_FILE"):
                verifier.validate_archive(archive)

    def test_operator_profile_files_are_required_for_v04(self):
        for missing in sorted(verifier.OPERATOR_PROFILE_FILES):
            with self.subTest(missing=missing):
                files = fixture_files()
                del files[missing]
                with archive_for(files) as archive:
                    with self.assertRaisesRegex(ValueError, "OPERATOR_PROFILE_PACKAGE_INCOMPLETE"):
                        verifier.validate_archive(archive)

    def test_v03_does_not_require_future_operator_profile_files(self):
        files = fixture_files()
        for path in verifier.OPERATOR_PROFILE_FILES:
            del files[path]
        catalog = json.loads(files["agents/manifest.json"])
        catalog["version"] = "0.3.0"
        files["agents/manifest.json"] = json.dumps(catalog).encode()
        with archive_for(files, version="0.3.0") as archive:
            result = verifier.validate_archive(archive, "1" * 40, "0.3.0")
        self.assertEqual(result["status"], "PASS")

    def test_reference_style_links_are_not_ignored(self):
        files = fixture_files()
        files["README.md"] = b"[missing][reference]\n[reference]: docs/MISSING.md\n"
        with archive_for(files) as archive:
            with self.assertRaisesRegex(ValueError, "BROKEN_RELATIVE_FILE_LINK"):
                verifier.validate_archive(archive)

    def test_inline_links_are_not_ignored(self):
        files = fixture_files()
        files["README.md"] = b"[missing](docs/MISSING.md)\n"
        with archive_for(files) as archive:
            with self.assertRaisesRegex(ValueError, "BROKEN_RELATIVE_FILE_LINK"):
                verifier.validate_archive(archive)

    def test_exact_inventory_still_rejects_unlisted_markdown(self):
        with archive_for(fixture_files(), unlisted={"docs/EXTRA.md": b"Synthetic extra.\n"}) as archive:
            with self.assertRaisesRegex(ValueError, "UNLISTED_ARCHIVE_FILE"):
                verifier.validate_archive(archive)

    def test_existing_per_file_digest_guard_remains_effective(self):
        with archive_for(fixture_files(), tampered={"README.md": b"Changed after manifest.\n"}) as archive:
            with self.assertRaisesRegex(ValueError, "FILE_DIGEST_MISMATCH"):
                verifier.validate_archive(archive)

    def test_legacy_calculators_cannot_be_replaced_by_equal_counts(self):
        files = fixture_files()
        catalog = json.loads(files["agents/manifest.json"])
        catalog["commands"][0]["calculatorId"] = "invented-calculator"
        files["agents/manifest.json"] = json.dumps(catalog).encode()
        with archive_for(files) as archive:
            with self.assertRaisesRegex(ValueError, "LEGACY_CALCULATORS_MISMATCH"):
                verifier.validate_archive(archive)


if __name__ == "__main__":
    unittest.main()
