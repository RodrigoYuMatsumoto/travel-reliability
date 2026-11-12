"""Project identity and privacy regressions for the actual SBOM CLI."""

import importlib.util
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NODE = shutil.which("node")


def sample():
    return {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
        "metadata": {"component": {
            "name": "arbitrary-checkout", "version": "0.0.1",
            "bom-ref": "arbitrary-checkout@0.0.1", "purl": "pkg:npm/arbitrary-checkout@0.0.1",
            "type": "library", "author": "synthetic identity",
        }},
        "components": [{"name": "fixture-dependency", "version": "1.0.0", "bom-ref": "fixture-dependency@1.0.0", "author": {"email": "synthetic@example.invalid"}}],
        "dependencies": [
            {"ref": "arbitrary-checkout@0.0.1", "dependsOn": ["fixture-dependency@1.0.0"]},
            {"ref": "fixture-dependency@1.0.0", "dependsOn": []},
        ],
    }


class SbomTests(unittest.TestCase):
    def project(self, body, metadata=None, supplemental=None):
        self.assertIsNotNone(NODE, "Node is required for the SBOM security regressions")
        code = """import {readFileSync} from 'node:fs';
const {projectSbom}=await import(process.argv[1]);
try {const p=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(projectSbom(p.body,p.metadata,p.supplemental)));}
catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}"""
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", code, (ROOT / "scripts/sbom-project.mjs").as_uri()],
            input=json.dumps({"body": body, "metadata": metadata or {"name": "travel-reliability", "version": "0.6.0"}, "supplemental": supplemental}),
            text=True, capture_output=True, timeout=15, check=False,
        )
        self.assertTrue(result.stdout, "The helper must return structured evidence")
        return result.returncode, json.loads(result.stdout)

    def test_checkout_name_and_root_graph_references_are_normalized(self):
        code, result = self.project(sample())
        self.assertEqual(code, 0)
        root = result["body"]["metadata"]["component"]
        self.assertEqual((root["name"], root["version"]), ("travel-reliability", "0.6.0"))
        self.assertEqual(root["purl"], "pkg:npm/travel-reliability@0.6.0")
        self.assertEqual(result["body"]["dependencies"][0]["ref"], root["bom-ref"])
        self.assertEqual(result["body"]["dependencies"][0]["dependsOn"], ["fixture-dependency@1.0.0"])
        self.assertEqual(result["omitted"], 2)
        self.assertNotIn("synthetic identity", json.dumps(result))
        self.assertNotIn("synthetic@example.invalid", json.dumps(result))

    def test_scoped_package_identity_keeps_valid_package_url(self):
        code, result = self.project(sample(), {"name": "@fixture/project", "version": "1.2.3-rc.1"})
        self.assertEqual(code, 0)
        self.assertEqual(result["body"]["metadata"]["component"]["purl"], "pkg:npm/%40fixture/project@1.2.3-rc.1")

    def test_public_https_package_references_are_preserved(self):
        body = sample()
        body["components"][0]["externalReferences"] = [{"type": "website", "url": "https://example.invalid/fixture"}]
        code, result = self.project(body)
        self.assertEqual(code, 0)
        self.assertEqual(result["body"]["components"][0]["externalReferences"], body["components"][0]["externalReferences"])

    def test_root_references_in_composition_arrays_are_updated(self):
        body = sample()
        body["compositions"] = [{"aggregate": "complete", "assemblies": ["arbitrary-checkout@0.0.1"]}]
        code, result = self.project(body)
        self.assertEqual(code, 0)
        self.assertEqual(result["body"]["compositions"][0]["assemblies"], ["travel-reliability@0.6.0"])

    def test_inconsistent_graph_and_local_paths_fail_closed(self):
        for mutation in ("missing-root", "duplicate-root", "private-path", "file-uri"):
            with self.subTest(mutation=mutation):
                body = sample()
                if mutation == "missing-root":
                    body["dependencies"] = []
                elif mutation == "duplicate-root":
                    body["dependencies"].append(body["dependencies"][0].copy())
                elif mutation == "private-path":
                    body["metadata"]["properties"] = [{"name": "fixture", "value": "C:" + "/Users/" + "synthetic/check-out"}]
                else:
                    body["metadata"]["properties"] = [{"name": "fixture", "value": "file:///synthetic/check-out"}]
                code, _ = self.project(body)
                self.assertNotEqual(code, 0)

    def test_invalid_package_identity_is_rejected(self):
        for identity in ({"name": "../outside", "version": "1.0.0"}, {"name": "fixture", "version": "../outside"}):
            with self.subTest(identity=identity):
                code, _ = self.project(sample(), identity)
                self.assertNotEqual(code, 0)

    def test_cli_anchors_manifest_npm_and_output_from_an_unrelated_directory(self):
        self.assertIsNotNone(NODE)
        with tempfile.TemporaryDirectory(prefix="travel-sbom-security-") as temporary:
            base = Path(temporary)
            project = base / "arbitrary-checkout-name"
            scripts = project / "scripts"
            scripts.mkdir(parents=True)
            caller = base / "unrelated-caller"
            caller.mkdir()
            for name in ("generate-sbom.mjs", "sbom-project.mjs"):
                shutil.copyfile(ROOT / "scripts" / name, scripts / name)
            (project / "package.json").write_text(json.dumps({"name": "travel-reliability", "version": "0.6.0", "type": "module"}), encoding="utf-8")
            fake_npm = project / "fixture-npm.mjs"
            fake_npm.write_text(
                "import {readFileSync} from 'node:fs';\n"
                "if(JSON.parse(readFileSync('package.json','utf8')).name!=='travel-reliability')process.exit(7);\n"
                "if(process.argv.slice(2).join(' ')!=='sbom --sbom-format cyclonedx')process.exit(8);\n"
                f"console.log(JSON.stringify({json.dumps(sample())}));\n",
                encoding="utf-8",
            )
            result = subprocess.run(
                [NODE, str(scripts / "generate-sbom.mjs")], cwd=caller,
                env={**os.environ, "npm_execpath": str(fake_npm)},
                text=True, capture_output=True, timeout=15, check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((caller / "sbom.cdx.json").exists())
            actual = json.loads((project / "sbom.cdx.json").read_text(encoding="utf-8"))
            self.assertEqual(actual["metadata"]["component"]["name"], "travel-reliability")
            self.assertNotIn("arbitrary-checkout", json.dumps(actual))

    def test_supplement_graph_attaches_to_root_and_preserves_existing_npm_edges(self):
        extra = {"format": "travel-reliability-python-inventory/1", "roots": ["python-context"],
                 "components": [{"type": "application", "name": "synthetic-python-context", "bom-ref": "python-context"},
                                {"type": "library", "name": "synthetic-python", "version": "1.0", "bom-ref": "pkg:pypi/synthetic-python@1.0"}],
                 "dependencies": [{"ref": "python-context", "dependsOn": ["pkg:pypi/synthetic-python@1.0"]},
                                  {"ref": "pkg:pypi/synthetic-python@1.0", "dependsOn": []}], "properties": []}
        code, result = self.project(sample(), supplemental=extra)
        self.assertEqual(code, 0)
        root = result["body"]["dependencies"][0]
        self.assertEqual(set(root["dependsOn"]), {"fixture-dependency@1.0.0", "python-context"})
        self.assertEqual(len(result["body"]["components"]), 3)
        self.assertEqual(result["omitted"], 2)

    def test_supplement_rejects_duplicate_identity_or_dangling_dependency(self):
        for mode in ("duplicate", "dangling"):
            extra = {"format": "travel-reliability-python-inventory/1", "roots": [],
                     "components": [], "dependencies": [], "properties": []}
            if mode == "duplicate":
                extra["components"] = [{"bom-ref": "fixture-dependency@1.0.0"}]
            else:
                extra["components"] = [{"bom-ref": "python-context"}]
                extra["dependencies"] = [{"ref": "python-context", "dependsOn": ["MISSING_SYNTHETIC_REFERENCE"]}]
            with self.subTest(mode=mode):
                self.assertNotEqual(self.project(sample(), supplemental=extra)[0], 0)


class PythonInventoryTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("sbom_python_inventory", ROOT / "scripts/sbom-python.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)

    def fixture(self, root, *, renderer=True):
        (root / "ingest").mkdir()
        content = '''version = 1
[[package]]
name = "synthetic-ingest"
version = "0.1.0"
source = { virtual = "." }
dependencies = [{ name = "alpha-core" }]
[package.dev-dependencies]
dev = [{ name = "beta-dev" }]
[[package]]
name = "alpha-core"
version = "1.0.0"
source = { registry = "https://pypi.org/simple" }
wheels = [{ url = "https://files.pythonhosted.org/packages/SYNTHETIC_ONLY.whl", hash = "sha256:''' + "a" * 64 + '''" }]
[[package]]
name = "beta-dev"
version = "2.0.0"
source = { registry = "https://pypi.org/simple" }
dependencies = [{ name = "alpha-core" }]
wheels = [{ url = "https://files.pythonhosted.org/packages/SYNTHETIC_ONLY.whl", hash = "sha256:''' + "b" * 64 + '''" }]
'''
        (root / "ingest/uv.lock").write_text(content, encoding="utf-8")
        if renderer:
            directory = root / "deploy/renderer"
            directory.mkdir(parents=True)
            (directory / "requirements.txt").write_bytes(("alpha_core==1.0.0 \\\r\n    --hash=sha256:" + "a" * 64 + "\r\n").encode())
            (directory / "provenance.json").write_text(json.dumps({
                "dependencies": [{"package": "alpha_core", "version": "1.0.0"}],
                "baseImage": "mcr.microsoft.com/playwright/python:v1.64.1-noble@sha256:" + "c" * 64,
            }), encoding="utf-8")

    def test_python_components_are_deduplicated_and_usage_scopes_distinguish_runtime_dev_renderer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result = self.module.inventory(root)
            alpha = [row for row in result["components"] if row.get("purl") == "pkg:pypi/alpha-core@1.0.0"]
            self.assertEqual(len(alpha), 1)
            labels = alpha[0]["properties"][0]["value"]
            for usage in ("ingest-runtime", "ingest-development", "renderer-pinned"):
                self.assertIn(usage, labels)
            beta = next(row for row in result["components"] if row.get("name") == "beta-dev")
            self.assertEqual(beta["scope"], "optional")
            self.assertEqual(alpha[0]["scope"], "required")
            self.assertEqual(len(result["roots"]), 2)

    def test_image_digest_is_included_without_claiming_complete_operating_system_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            result = self.module.inventory(root)
            image = next(row for row in result["components"] if row["type"] == "container")
            self.assertEqual(image["hashes"][0]["content"], "c" * 64)
            self.assertIn("OS/browser package contents are not enumerated", json.dumps(image))
            self.assertNotIn(str(root), json.dumps(result))
            self.assertNotIn("author", json.dumps(result))

    def test_nonpublic_lock_sources_missing_hashes_or_dangling_edges_fail(self):
        for mode in ("private-source", "missing-hash", "dangling"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root, renderer=False)
                path = root / "ingest/uv.lock"
                text = path.read_text(encoding="utf-8")
                if mode == "private-source":
                    text = text.replace("https://pypi.org/simple", "https://example.invalid/private")
                elif mode == "missing-hash":
                    text = text.replace("sha256:" + "a" * 64, "missing")
                else:
                    text = text.replace('dependencies = [{ name = "alpha-core" }]', 'dependencies = [{ name = "missing-synthetic" }]')
                path.write_text(text, encoding="utf-8")
                with self.assertRaises(ValueError):
                    self.module.inventory(root)

    def test_renderer_unpinned_requirements_or_mutable_image_fail(self):
        for mode in ("unpinned", "mutable-image", "partial-metadata"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.fixture(root)
                if mode == "unpinned":
                    (root / "deploy/renderer/requirements.txt").write_text("alpha-core>=1.0\n", encoding="utf-8")
                elif mode == "mutable-image":
                    path = root / "deploy/renderer/provenance.json"
                    value = json.loads(path.read_text(encoding="utf-8"))
                    value["baseImage"] = "mcr.microsoft.com/playwright/python:latest"
                    path.write_text(json.dumps(value), encoding="utf-8")
                else:
                    (root / "deploy/renderer/provenance.json").unlink()
                with self.assertRaises(ValueError):
                    self.module.inventory(root)

    def test_source_does_not_execute_or_contact_any_package_artifact(self):
        source = (ROOT / "scripts/sbom-python.py").read_text(encoding="utf-8")
        for forbidden in ("import subprocess", "import requests", "urlopen(", "exec(", "eval("):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()
