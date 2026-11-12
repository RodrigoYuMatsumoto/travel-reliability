"""Synthetic release fixtures: no real accounts, review captures or publication."""

import importlib.util
from copy import deepcopy
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "release-bundle.py"
SPEC = importlib.util.spec_from_file_location("release_bundle", SCRIPT)
bundle = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(bundle)

VERSION = "0.6.0"
COMMIT = "a" * 40
TREE = "b" * 40
BASELINE = "c" * 40
CALCULATORS = ["flex-dates", "airports", "connections", "promotions", "total-cost", "fare-scenarios", "negotiation", "hidden-city", "group-split", "loyalty-arbitrage", "multimodal-stitching"]


def zip_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (2020, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, content)
    return stream.getvalue()


class ReleaseFixture:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.names = bundle.asset_names(VERSION)
        commands = [{"id": name, "calculatorId": name, "path": f"prompts/{index:02d}_{name.replace('-', '_')}.md"} for index, name in enumerate(CALCULATORS, 1)]
        self.catalog = {"version": VERSION, "agents": [{"path": "agents/TRAVEL_AGENT.md"}], "commands": commands, "contracts": {"trip": "schema/trip.schema.json"}}
        self.counts = {"agents": 1, "workflows": len(CALCULATORS), "calculators": len(CALCULATORS)}
        selected = {"LICENSE": b"Synthetic test license\n", "NOTICE": b"Synthetic test notice\n", "agents/TRAVEL_AGENT.md": b"Synthetic instructions\n", "agents/manifest.json": bundle.json_bytes(self.catalog), "schema/trip.schema.json": b"{}\n", "schema/operator-profile.schema.json": b"{}\n", "examples/operator-profile.json": b"{}\n", "docs/OPERATOR_PROFILE.md": b"Synthetic setup\n", "docs/UNICODE_EXPORTS.md": b"Synthetic Unicode guidance\n"}
        selected.update({item["path"]: b"Synthetic documentary workflow\n" for item in commands})
        self.source_files = dict(selected)
        self.source_files.update({"package.json": bundle.json_bytes({"name": "travel-reliability", "version": VERSION}), "api/src/planning.ts": b"export const synthetic = true;\n", "skills/travel-agent/SKILL.md": b"Synthetic skill\n"})
        self.assets = {self.names["source"]: zip_bytes({f"travel-reliability-v{VERSION}/{name}": data for name, data in self.source_files.items()})}
        artifacts = []
        for kind in ["agent-kit", "skill"]:
            if kind == "agent-kit":
                prefix = f"travel-reliability-agent-kit-v{VERSION}/"
                contents = dict(selected)
            else:
                prefix = "travel-agent/"
                contents = {(name if name in {"LICENSE", "NOTICE"} else "references/" + name): data for name, data in selected.items()}
                contents.update({"SKILL.md": b"Synthetic skill\n", "references/agent.md": b"Synthetic instructions\n"})
            manifest = {"format": f"travel-reliability-{kind}/1", "version": VERSION, "sourceCommit": COMMIT, "counts": self.counts, "files": [{"path": name, "sha256": bundle.digest(data)} for name, data in sorted(contents.items())]}
            contents["PACKAGE-MANIFEST.json"] = bundle.json_bytes(manifest)
            self.assets[self.names[kind]] = zip_bytes({prefix + name: data for name, data in contents.items()})
            artifacts.append({"kind": kind, "name": self.names[kind], "sha256": bundle.digest(self.assets[self.names[kind]]), "files": len(contents)})
        self.assets[self.names["agent-manifest"]] = bundle.json_bytes({"version": VERSION, "commit": COMMIT, "counts": self.counts, "artifacts": artifacts})
        self.assets[self.names["agent-sums"]] = "".join(f"{row['sha256']}  {row['name']}\n" for row in artifacts).encode("ascii")
        self.assets[self.names["sbom"]] = bundle.json_bytes({"bomFormat": "CycloneDX", "metadata": {"component": {"name": "travel-reliability", "version": VERSION}}, "components": []})
        self.evidence = {"format": "travel-reliability-release-evidence/1", "version": VERSION, "sourceCommit": COMMIT, "sourceTree": TREE, "generatedAt": "2026-11-02T00:00:00Z", "workflows": [self.workflow(1, ["verify"], ".github/workflows/ci.yml"), self.workflow(2, sorted(bundle.REQUIRED_CHECKS - {"verify"}), ".github/workflows/security-audit.yml")]}
        self.reviewed = ["api/src/planning.ts", "schema/trip.schema.json"]
        criteria = self.object("criteria.json", b'{"criteria":["What is supported?"]}\n')
        eligibility = self.object("eligibility.json", b'{"synthetic":true,"notRealEvidence":true}\n')
        responses = []
        for family in ["google", "deepseek"]:
            response = self.object(f"response-{family}.txt", (family + " synthetic review: SUPPORTED\n").encode())
            responses.append({"family": family, "result": "APPROVE", **response, "eligibility": eligibility})
        self.receipt = {"format": "travel-reliability-b9-receipt/1", "version": VERSION, "sourceCommit": COMMIT, "sourceTree": TREE, "baselineCommit": BASELINE, "result": "APPROVE", "generatorFamilies": ["openai"], "files": [{"path": name, "sha256": bundle.digest(self.source_files[name])} for name in self.reviewed], "deletedPaths": [], "packets": [{"id": "A1", "files": self.reviewed, "criteria": criteria, "responses": responses}]}

    @staticmethod
    def workflow(run_id, jobs, path):
        return {"id": run_id, "attempt": 1, "sourceCommit": COMMIT, "headBranch": "main", "event": "push", "status": "completed", "conclusion": "success", "workflow": path, "jobs": [{"name": name, "conclusion": "success"} for name in jobs]}

    def object(self, name, content):
        (self.directory / name).write_bytes(content)
        return {"object": name, "sha256": bundle.digest(content)}

    def build(self, stable=False):
        return bundle.build_bundle(self.assets, self.evidence, self.receipt, self.directory, self.reviewed, [], stable)


class ReleaseBundleTests(unittest.TestCase):
    def test_raw_git_snapshot_includes_export_ignored_files(self):
        with tempfile.TemporaryDirectory(prefix="travel-source-binding-") as directory:
            root = Path(directory)
            (root / ".gitattributes").write_text("hidden.txt export-ignore\n", encoding="utf-8")
            (root / "hidden.txt").write_bytes(b"synthetic committed source\n")
            bundle.safe_git(root, ["init", "--quiet"])
            bundle.safe_git(root, ["add", ".gitattributes", "hidden.txt"])
            bundle.safe_git(root, ["-c", "user.name=Travel Maintainer", "-c", "user.email=maintainer@example.invalid", "-c", "core.hooksPath=", "commit", "--quiet", "-m", "synthetic snapshot"])
            commit = bundle.safe_git(root, ["rev-parse", "HEAD"])
            self.assertEqual(bundle.git_source_snapshot(root, commit), {".gitattributes": b"hidden.txt export-ignore\n", "hidden.txt": b"synthetic committed source\n"})

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="travel-release-synthetic-")
        self.addCleanup(self.temporary.cleanup)
        self.fixture = ReleaseFixture(self.temporary.name)

    def verify_with_trusted_snapshot(self, output, metadata=None):
        repository = self.fixture.directory / "trusted-checkout"
        repository.mkdir(exist_ok=True)

        def git_result(_root, args, binary=False):
            if args == ["rev-parse", "--show-toplevel"]:
                return str(repository.resolve())
            if args == ["rev-parse", f"{COMMIT}^{{tree}}"]:
                return TREE
            if args == ['merge-base', '--is-ancestor', BASELINE, COMMIT]:
                return ''
            if args == ['diff', '--name-only', '--diff-filter=ACMRT', BASELINE, COMMIT]:
                return '\n'.join(self.fixture.reviewed)
            if args == ['diff', '--name-only', '--diff-filter=D', BASELINE, COMMIT]:
                return ''
            raise AssertionError("Unexpected fixture Git operation")

        with patch.object(bundle, "safe_git", side_effect=git_result), patch.object(bundle, "git_source_snapshot", return_value=self.fixture.source_files):
            return bundle.verify_bundle(output, COMMIT, VERSION, True, metadata, repository, self.synthetic_actions)

    def synthetic_actions(self, endpoint):
        rows = self.fixture.evidence['workflows']
        def run(row):
            return {'id': row['id'], 'head_sha': COMMIT, 'head_branch': 'main', 'event': row['event'], 'path': row['workflow'], 'run_attempt': row['attempt'], 'status': row['status'], 'conclusion': row['conclusion'], 'created_at': '2026-11-03T00:00:00Z'}
        if '?head_sha=' in endpoint:
            return {'total_count': 2, 'workflow_runs': [run(row) for row in rows]}
        row = next(row for row in rows if f"/runs/{row['id']}" in endpoint)
        if '/jobs?' in endpoint:
            return {'total_count': len(row['jobs']), 'jobs': [{**job, 'status': 'completed'} for job in row['jobs']]}
        return run(row)

    def test_main_branch_and_one_run_per_workflow_are_mandatory(self):
        for branch in [None, 'other']:
            changed = deepcopy(self.fixture.evidence['workflows'])
            changed[0]['headBranch'] = branch
            self.assertFalse(bundle.validate_workflows(changed, COMMIT)[1])
        changed = deepcopy(self.fixture.evidence['workflows'])
        duplicate = deepcopy(changed[0]); duplicate['id'] = 99; changed.append(duplicate)
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_WORKFLOW_PATH'):
            bundle.validate_workflows(changed, COMMIT)

    def test_offline_verification_never_claims_current_stable_eligibility(self):
        assets, _ = self.fixture.build(stable=True)
        output = self.fixture.directory / 'offline-check'
        output.mkdir()
        for name, data in assets.items(): (output / name).write_bytes(data)
        report = bundle.verify_bundle(output)
        self.assertTrue(report['recordedEligible'])
        self.assertFalse(report['stableEligible'])
        self.assertEqual(report['actionsBinding'], 'NOT_RUN')

    def test_live_actions_rejects_newer_failures_and_wrong_attempts(self):
        rows = self.fixture.evidence['workflows']
        self.assertTrue(bundle.verify_actions(rows, COMMIT, self.synthetic_actions))
        def newer(endpoint):
            value = self.synthetic_actions(endpoint)
            if '?head_sha=' in endpoint:
                row = dict(value['workflow_runs'][0], id=999, conclusion='failure', created_at='2026-11-04T00:00:00Z')
                value['workflow_runs'].append(row); value['total_count'] += 1
            return value
        with self.assertRaisesRegex(ValueError, 'ACTIONS_NEWER_RUN_EXISTS'):
            bundle.verify_actions(rows, COMMIT, newer)
        def wrong(endpoint):
            value = self.synthetic_actions(endpoint)
            if '?head_sha=' not in endpoint and '/jobs?' not in endpoint: value['run_attempt'] = 2
            return value
        with self.assertRaisesRegex(ValueError, 'ACTIONS_RUN_BINDING_MISMATCH'):
            bundle.verify_actions(rows, COMMIT, wrong)

    def test_nine_assets_are_deterministic_for_the_same_inputs(self):
        first, report = self.fixture.build(stable=True)
        second, _ = self.fixture.build(stable=True)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 9)
        self.assertTrue(report["releaseEligibility"]["eligible"])
        self.assertNotIn(self.temporary.name, json.dumps(report))
        self.assertNotIn("Synthetic review", json.dumps(report))

    def test_offline_candidate_does_not_invent_b9_approval(self):
        _, report = bundle.build_bundle(self.fixture.assets, self.fixture.evidence)
        self.assertEqual(report["review"]["overall"], "NOT_RUN")
        self.assertFalse(report["releaseEligibility"]["eligible"])
        with self.assertRaisesRegex(ValueError, "STABLE_RELEASE_GATE_NOT_SATISFIED"):
            bundle.build_bundle(self.fixture.assets, self.fixture.evidence, require_stable=True)

    def test_missing_or_prior_commit_ci_blocks_stable(self):
        self.fixture.evidence["workflows"][0]["sourceCommit"] = BASELINE
        with self.assertRaisesRegex(ValueError, "WORKFLOW_COMMIT_MISMATCH"):
            self.fixture.build(stable=True)

    def test_pull_request_checks_do_not_replace_main_push_checks(self):
        for workflow in self.fixture.evidence["workflows"]:
            workflow["event"] = "pull_request"
        with self.assertRaisesRegex(ValueError, "STABLE_RELEASE_GATE_NOT_SATISFIED"):
            self.fixture.build(stable=True)

    def test_changed_review_capture_is_rejected_even_with_same_verdict(self):
        path = self.fixture.directory / "response-google.txt"
        path.write_text("APPROVE but different justification\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "REVIEW_OBJECT_DIGEST_MISMATCH"):
            self.fixture.build(stable=True)

    def test_criteria_and_eligibility_are_hash_bound(self):
        (self.fixture.directory / "eligibility.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "REVIEW_OBJECT_DIGEST_MISMATCH"):
            self.fixture.build(stable=True)

    def test_missing_delta_coverage_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "REVIEW_DELTA_COVERAGE_MISSING"):
            bundle.build_bundle(self.fixture.assets, self.fixture.evidence, self.fixture.receipt, self.fixture.directory, ["package.json"], [], True)

    def test_same_family_as_generator_is_rejected(self):
        self.fixture.receipt["packets"][0]["responses"][0]["family"] = "openai"
        with self.assertRaisesRegex(ValueError, "REVIEW_FAMILY_NOT_DISTINCT"):
            self.fixture.build(stable=True)

    def test_xai_and_maritaca_can_review_openai_anthropic_without_weakening_quorum(self):
        self.fixture.receipt["generatorFamilies"] = ["openai", "anthropic"]
        responses = self.fixture.receipt["packets"][0]["responses"]
        for response, family in zip(responses, ["maritaca", "xai"], strict=True):
            response.update(self.fixture.object(f"response-{family}.txt", f"Synthetic {family} review\n".encode()))
            response["family"] = family
        _, report = self.fixture.build(stable=True)
        self.assertTrue(report["releaseEligibility"]["eligible"])
        self.fixture.receipt["generatorFamilies"].append("xai")
        with self.assertRaisesRegex(ValueError, "REVIEW_FAMILY_NOT_DISTINCT"):
            self.fixture.build(stable=True)

    def test_public_approval_string_without_bound_packets_is_not_enough(self):
        with self.assertRaisesRegex(ValueError, "INVALID_PUBLIC_REVIEW"):
            bundle.public_review_approved({"overall": "APPROVE"}, COMMIT, TREE)

    def test_successful_workflow_must_cover_its_actual_job_scope(self):
        self.fixture.evidence["workflows"][0]["jobs"][0]["name"] = "SAST (Semgrep and Bandit)"
        with self.assertRaisesRegex(ValueError, "WORKFLOW_JOB_COVERAGE_MISMATCH"):
            self.fixture.build(stable=True)

    def test_caveat_cannot_be_downgraded_to_approval(self):
        self.fixture.receipt["packets"][0]["responses"][0]["result"] = "APPROVE_WITH_CAVEATS"
        with self.assertRaisesRegex(ValueError, "REVIEW_VERDICT_CONTRADICTION"):
            self.fixture.build(stable=True)
        self.fixture.receipt["result"] = "APPROVE_WITH_CAVEATS"
        _, report = self.fixture.build(stable=True)
        self.assertEqual(report["review"]["overall"], "APPROVE_WITH_CAVEATS")

    def test_response_cannot_count_twice_under_different_family(self):
        responses = self.fixture.receipt["packets"][0]["responses"]
        responses[1]["object"] = responses[0]["object"]
        responses[1]["sha256"] = responses[0]["sha256"]
        with self.assertRaisesRegex(ValueError, "REUSED_REVIEW_RESPONSE"):
            self.fixture.build(stable=True)

    def test_local_review_paths_cannot_escape_evidence_directory(self):
        self.fixture.receipt["packets"][0]["criteria"]["object"] = "../criteria.json"
        with self.assertRaisesRegex(ValueError, "INVALID_REVIEW_OBJECT"):
            self.fixture.build(stable=True)

    def test_wrong_sbom_project_identity_is_rejected(self):
        self.fixture.assets["sbom.cdx.json"] = bundle.json_bytes({"bomFormat": "CycloneDX", "metadata": {"component": {"name": "private-clone-folder", "version": VERSION}}, "components": []})
        with self.assertRaisesRegex(ValueError, "SBOM_IDENTITY_MISMATCH"):
            self.fixture.build()

    def test_agent_manifest_does_not_copy_extra_metadata(self):
        name = self.fixture.names["agent-manifest"]
        manifest = json.loads(self.fixture.assets[name])
        manifest["operatorNote"] = "synthetic private note"
        self.fixture.assets[name] = bundle.json_bytes(manifest)
        with self.assertRaisesRegex(ValueError, "AGENT_MANIFEST_FIELDS_REJECTED"):
            self.fixture.build()

    def test_invalid_calendar_date_is_not_accepted_as_evidence_time(self):
        self.fixture.evidence["generatedAt"] = "2026-99-99T00:00:00Z"
        with self.assertRaisesRegex(ValueError, "INVALID_EVIDENCE_TIME"):
            self.fixture.build()

    def test_private_source_archive_path_is_rejected(self):
        source = dict(self.fixture.source_files)
        source[".env"] = b"synthetic fixture only\n"
        self.fixture.assets[self.fixture.names["source"]] = zip_bytes({f"travel-reliability-v{VERSION}/{name}": data for name, data in source.items()})
        with self.assertRaisesRegex(ValueError, "FORBIDDEN_PUBLIC_PATH"):
            self.fixture.build()

    def test_duplicate_json_keys_are_not_silently_overwritten(self):
        with self.assertRaisesRegex(ValueError, "DUPLICATE_JSON_KEY"):
            bundle.strict_json(b'{"result":"REJECT","result":"APPROVE"}')

    def test_download_verification_checks_membership_and_all_hashes(self):
        assets, _ = self.fixture.build(stable=True)
        output = self.fixture.directory / "download"
        output.mkdir()
        for name, content in assets.items():
            (output / name).write_bytes(content)
        metadata = {"tag_name": "v" + VERSION, "draft": False, "prerelease": False, "assets": [{"name": name, "digest": "sha256:" + bundle.digest(data)} for name, data in assets.items()]}
        result = self.verify_with_trusted_snapshot(output, metadata)
        self.assertEqual(result["assets"], 9)
        self.assertEqual(result["sourceTreeBinding"], "PASS")
        (output / "unlisted.txt").write_text("synthetic sentinel", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "RELEASE_ASSET_INVENTORY_MISMATCH"):
            bundle.verify_bundle(output)

    def test_download_modification_fails_checksum_validation(self):
        assets, _ = self.fixture.build()
        output = self.fixture.directory / "download"
        output.mkdir()
        for name, content in assets.items():
            (output / name).write_bytes(content)
        (output / self.fixture.names["audit"]).write_bytes(b"{}\n")
        with self.assertRaisesRegex(ValueError, "CHECKSUM_MISMATCH"):
            bundle.verify_bundle(output)

    def test_stable_download_requires_a_trusted_source_checkout(self):
        assets, _ = self.fixture.build(stable=True)
        output = self.fixture.directory / "download"
        output.mkdir()
        for name, content in assets.items():
            (output / name).write_bytes(content)
        with self.assertRaisesRegex(ValueError, "TRUSTED_SOURCE_CHECKOUT_REQUIRED"):
            bundle.verify_bundle(output, COMMIT, VERSION, True)

    def test_self_consistent_forged_source_is_rejected_against_trusted_git_bytes(self):
        assets, _ = self.fixture.build(stable=True)
        changed = dict(self.fixture.source_files)
        changed["api/src/planning.ts"] = b"unreviewed replacement with the same declared commit\n"
        source_name = self.fixture.names["source"]
        assets[source_name] = zip_bytes({f"travel-reliability-v{VERSION}/{name}": data for name, data in changed.items()})
        manifest = json.loads(assets[self.fixture.names["manifest"]])
        for item in manifest["assets"]:
            if item["name"] == source_name:
                item["sha256"] = bundle.digest(assets[source_name])
        assets[self.fixture.names["manifest"]] = bundle.json_bytes(manifest)
        assets[self.fixture.names["sums"]] = "".join(f"{bundle.digest(data)}  {name}\n" for name, data in sorted(assets.items()) if name != self.fixture.names["sums"]).encode("ascii")
        output = self.fixture.directory / "download"
        output.mkdir()
        for name, content in assets.items():
            (output / name).write_bytes(content)
        with self.assertRaisesRegex(ValueError, "SOURCE_TREE_BLOB_MISMATCH"):
            self.verify_with_trusted_snapshot(output)

    def test_source_zip_rejects_windows_aliases_and_file_directory_collisions(self):
        cases = [("docs/CON.txt", "NONPORTABLE_PUBLIC_PATH"), ("docs/trailing.", "NONPORTABLE_PUBLIC_PATH"), ("Docs/alias.md", "ARCHIVE_CASE_ALIAS_REJECTED")]
        for name, error in cases:
            source = dict(self.fixture.source_files)
            source[name] = b"synthetic unsafe member\n"
            with self.assertRaisesRegex(ValueError, error):
                bundle.source_files(zip_bytes({f"travel-reliability-v{VERSION}/{path}": data for path, data in source.items()}), VERSION)
        source = dict(self.fixture.source_files)
        source.update({"collision": b"file", "collision/child.md": b"child"})
        with self.assertRaisesRegex(ValueError, "ARCHIVE_FILE_DIRECTORY_COLLISION"):
            bundle.source_files(zip_bytes({f"travel-reliability-v{VERSION}/{path}": data for path, data in source.items()}), VERSION)

    def test_source_zip_rejects_nul_normalized_original_filename(self):
        source = dict(self.fixture.source_files)
        source["api/src/planning.tsX"] = source.pop("api/src/planning.ts")
        archive = zip_bytes({f"travel-reliability-v{VERSION}/{path}": data for path, data in source.items()})
        corrupted = archive.replace(b"api/src/planning.tsX", b"api/src/planning.ts\0")
        self.assertNotEqual(archive, corrupted)
        with self.assertRaisesRegex(ValueError, "ARCHIVE_PATH_NORMALIZATION_REJECTED"):
            bundle.source_files(corrupted, VERSION)

    def test_public_report_does_not_copy_extra_private_evidence_fields(self):
        self.fixture.evidence["untrustedOperatorNote"] = "do not publish this synthetic note"
        self.fixture.receipt["privateConversationUrl"] = "https://invalid.example/private"
        _, report = self.fixture.build()
        self.assertNotIn("untrustedOperatorNote", json.dumps(report))
        self.assertNotIn("privateConversationUrl", json.dumps(report))

    def test_source_archive_must_match_every_committed_blob(self):
        files = {"package.json": b"{}\n", "api/src/planning.ts": b"synthetic fixture\n"}
        bundle.validate_git_source_tree(files, dict(files))
        changed = dict(files)
        changed["api/src/planning.ts"] = b"unreviewed replacement\n"
        with self.assertRaisesRegex(ValueError, "SOURCE_TREE_BLOB_MISMATCH"):
            bundle.validate_git_source_tree(changed, files)
        changed["unlisted.txt"] = b"unlisted source\n"
        with self.assertRaisesRegex(ValueError, "SOURCE_TREE_INVENTORY_MISMATCH"):
            bundle.validate_git_source_tree(changed, files)


if __name__ == "__main__":
    unittest.main()
