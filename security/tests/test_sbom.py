"""Project identity and privacy regressions for the actual SBOM CLI."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


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
    def project(self, body, metadata=None):
        self.assertIsNotNone(NODE, "Node is required for the SBOM security regressions")
        code = """import {readFileSync} from 'node:fs';
const {projectSbom}=await import(process.argv[1]);
try {const p=JSON.parse(readFileSync(0,'utf8'));console.log(JSON.stringify(projectSbom(p.body,p.metadata)));}
catch(error){console.log(JSON.stringify({error:error.message}));process.exitCode=1;}"""
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", code, (ROOT / "scripts/sbom-project.mjs").as_uri()],
            input=json.dumps({"body": body, "metadata": metadata or {"name": "travel-reliability", "version": "0.6.0"}}),
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
                if mutation == "missing-root": body["dependencies"] = []
                elif mutation == "duplicate-root": body["dependencies"].append(body["dependencies"][0].copy())
                elif mutation == "private-path": body["metadata"]["properties"] = [{"name": "fixture", "value": "C:" + "/Users/" + "synthetic/check-out"}]
                else: body["metadata"]["properties"] = [{"name": "fixture", "value": "file:///synthetic/check-out"}]
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


if __name__ == "__main__":
    unittest.main()
