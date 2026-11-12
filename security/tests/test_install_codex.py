import errno
import importlib.util
import json
import os
import stat
import subprocess
import tempfile
import tomllib
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "travel_codex_installer", Path(__file__).resolve().parents[2] / "scripts/install-codex.py"
)
installer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(installer)
COMMIT = "a" * 40


def archive(path, files):
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as output:
        for name, body in files:
            item = zipfile.ZipInfo(name)
            # Preserve malicious raw names too; ZipInfo normalizes separators on Windows.
            item.filename = name
            item.orig_filename = name
            item.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(item, body)
    return installer.digest(path.read_bytes())


def fixture(root, links=False, tools=None, python_source=True):
    source = {
        "package.json": json.dumps({"name": "travel-reliability", "version": "0.6.0"}).encode(),
        "package-lock.json": json.dumps({"lockfileVersion": 3, "packages": {}}).encode(),
        "scripts/agent-mcp.mjs": b"// Synthetic fixture, never executed.\n",
        "agents/manifest.json": json.dumps({"optionalRuntime": {
            "tools": installer.TOOLS if tools is None else tools,
        }}).encode(),
        "skills/travel-agent/SKILL.md": b"---\nname: travel-agent\n---\nSynthetic instructions.\n",
    }
    if python_source:
        source.update({
            "ingest/pyproject.toml": b'[project]\nname="synthetic-ingest"\nversion="0.1.0"\nrequires-python=">=3.12,<3.13"\n',
            "ingest/uv.lock": (
                'version=1\n[[package]]\nname="synthetic"\nversion="1.0"\n'
                'source={registry="https://pypi.org/simple"}\n'
                'wheels=[{url="https://files.pythonhosted.org/synthetic.whl",hash="sha256:'
                + '0' * 64 + '"}]\n'
            ).encode(),
            "ingest/travel_ingest/packages/__init__.py": b"# Synthetic fixture; never executed.\n",
        })
    skill = {"SKILL.md": source["skills/travel-agent/SKILL.md"]}
    bindings = {"SKILL.md": "skills/travel-agent/SKILL.md"}
    for filename in installer.ALIASES.values():
        source["prompts/" + filename] = ("Synthetic prompt: " + filename).encode()
        name = "references/prompts/" + filename
        skill[name] = source["prompts/" + filename]
        bindings[name] = "prompts/" + filename
    if links:
        prompt = next(iter(installer.ALIASES.values()))
        source["README.md"] = b"# Synthetic project\n"
        source["prompts/" + prompt] = b"Read [project](../README.md).\n"
        skill["references/prompts/" + prompt] = (
            f"Read [project](https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/{COMMIT}/README.md).\n"
        ).encode()
        source["skills/travel-agent/SKILL.md"] = (
            f"See [dates](../../prompts/{prompt}#scope) and [project](../../README.md).\n"
        ).encode()
        skill["SKILL.md"] = (
            f"See [dates](references/prompts/{prompt}#scope) and "
            f"[project](https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/{COMMIT}/README.md).\n"
        ).encode()
    skill["PACKAGE-MANIFEST.json"] = json.dumps({
        "version": "0.6.0", "sourceCommit": COMMIT,
        "files": [{"path": name, "sha256": installer.digest(body),
                   "sourcePath": bindings[name],
                   "sourceSha256": installer.digest(source[bindings[name]])}
                  for name, body in skill.items()],
    }).encode()
    source_zip, skill_zip = root / "source.zip", root / "skill.zip"
    source_hash = archive(source_zip, [("source/" + key, value) for key, value in source.items()])
    skill_hash = archive(skill_zip, [("travel-agent/" + key, value) for key, value in skill.items()])
    release = json.dumps({"version": "0.6.0", "commit": COMMIT, "artifact": source_zip.name,
                          "sha256": source_hash}).encode()
    (root / "release-manifest.json").write_bytes(release)
    sums = root / "SHA256SUMS"
    sums.write_text(
        f"{source_hash}  {source_zip.name}\n{skill_hash}  {skill_zip.name}\n"
        f"{installer.digest(release)}  release-manifest.json\n", encoding="utf-8"
    )
    return source_zip, skill_zip, sums


def old_config():
    original = '# Preserved exactly outside Travel.\nmode = "synthetic"\n'
    for number in range(18):
        original += f'[mcp_servers.other_{number}]\ncommand = "synthetic"\nargs = []\n'
    original += '[mcp_servers.travel-reliability]\ncommand = "old"\nargs = ["old-entry"]\n'
    return original.encode()


@unittest.skipUnless(os.name == "nt", "Automatic apply requires native Windows exclusive handles")
class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="travel-installer-unit-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.inputs = fixture(self.root)
        self.codex, self.skills = self.root / "codex", self.root / "skills"
        self.codex.mkdir()
        self.skills.mkdir()
        self.config = self.codex / "config.toml"
        self.config.write_bytes(old_config())
        self.node = self.root / "node.exe"
        self.node.write_bytes(b"Not executable; tests do not run this file.")
        self.original_skills = {}
        for name in ["travel-agent", *installer.ALIASES]:
            target = self.skills / name
            target.mkdir()
            body = ("Original " + name).encode()
            (target / "SKILL.md").write_bytes(body)
            self.original_skills[name] = body
        self.runtime = self.codex / "tools/travel-reliability/v0.6.0"
        self.candidate_runtime = self.runtime.with_name("v0.6.0-candidate-" + COMMIT[:12])

    def install(self, **kwargs):
        return installer.install(*self.inputs, self.codex, self.skills, self.node,
                                 dependencies=kwargs.pop("dependencies", False), **kwargs)

    def assert_restored(self):
        self.assertEqual(self.config.read_bytes(), old_config())
        for name, body in self.original_skills.items():
            self.assertEqual((self.skills / name / "SKILL.md").read_bytes(), body)
        self.assertFalse(self.runtime.exists())
        records = list(self.codex.glob("backups/*/rollback.json"))
        self.assertTrue(records)
        self.assertTrue(all(json.loads(path.read_text(encoding="utf-8"))["status"] == "RESTORED" for path in records))

    def existing_version_sentinel(self):
        self.runtime.mkdir(parents=True)
        sentinel = self.runtime / "preserved.txt"
        sentinel.write_bytes(b"Synthetic existing runtime; preserve exactly.\n")
        return sentinel

    def assert_candidate_failure_restored(self, sentinel):
        self.assertEqual(self.config.read_bytes(), old_config())
        self.assertEqual(sentinel.read_bytes(), b"Synthetic existing runtime; preserve exactly.\n")
        self.assertFalse(self.candidate_runtime.exists())
        for name, body in self.original_skills.items():
            self.assertEqual((self.skills / name / "SKILL.md").read_bytes(), body)
        records = list(self.codex.glob("backups/*/rollback.json"))
        self.assertTrue(records)
        self.assertTrue(all(json.loads(path.read_text(encoding="utf-8"))["status"] == "RESTORED" for path in records))

    def test_candidate_uses_verified_commit_key_and_preserves_existing_version(self):
        sentinel = self.existing_version_sentinel()
        record = self.install(candidate=True)
        self.assertEqual(record["channel"], "candidate")
        self.assertEqual(record["runtimeKey"], "v0.6.0-candidate-" + COMMIT[:12])
        self.assertEqual(record["sourceCommit"], COMMIT)
        self.assertTrue((self.candidate_runtime / "scripts/agent-mcp.mjs").is_file())
        self.assertEqual(sentinel.read_bytes(), b"Synthetic existing runtime; preserve exactly.\n")
        before = tomllib.loads(old_config().decode("utf-8"))
        after = tomllib.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(after["mcp_servers"]["travel-reliability"]["args"], [str(self.candidate_runtime / "scripts/agent-mcp.mjs")])
        before["mcp_servers"].pop("travel-reliability")
        after["mcp_servers"].pop("travel-reliability")
        self.assertEqual(after, before)
        recorded = [json.loads(path.read_text(encoding="utf-8")) for path in self.codex.glob("backups/*/installation.json")]
        self.assertEqual(recorded, [record])

    def test_existing_candidate_is_preserved_without_any_second_install_mutation(self):
        sentinel = self.existing_version_sentinel()
        self.install(candidate=True)
        config = self.config.read_bytes()
        source = (self.candidate_runtime / "scripts/agent-mcp.mjs").read_bytes()
        skills = {name: (self.skills / name / "SKILL.md").read_bytes() for name in self.original_skills}
        backups = set(self.codex.glob("backups/*"))
        with self.assertRaisesRegex(ValueError, "VERSION_ALREADY_INSTALLED_PRESERVED"):
            self.install(candidate=True)
        self.assertEqual(self.config.read_bytes(), config)
        self.assertEqual((self.candidate_runtime / "scripts/agent-mcp.mjs").read_bytes(), source)
        self.assertEqual({name: (self.skills / name / "SKILL.md").read_bytes() for name in skills}, skills)
        self.assertEqual(set(self.codex.glob("backups/*")), backups)
        self.assertEqual(sentinel.read_bytes(), b"Synthetic existing runtime; preserve exactly.\n")

    def test_candidate_failure_before_runtime_promotion_preserves_previous_state(self):
        sentinel = self.existing_version_sentinel()
        rename = Path.rename
        def interrupt(source, destination):
            if source.name == "runtime" and destination == self.candidate_runtime:
                raise OSError("Synthetic candidate runtime promotion failure")
            return rename(source, destination)
        with patch.object(Path, "rename", interrupt):
            with self.assertRaises(OSError):
                self.install(candidate=True)
        self.assert_candidate_failure_restored(sentinel)
        self.assertTrue(list(self.codex.glob("backups/*/failed/staged-runtime/package.json")))

    def test_candidate_failure_after_config_write_restores_previous_state(self):
        sentinel = self.existing_version_sentinel()
        write = Path.write_text
        def interrupt(path, *args, **kwargs):
            if path.name == "installation.json":
                raise OSError("Synthetic candidate installation record failure")
            return write(path, *args, **kwargs)
        with patch.object(Path, "write_text", interrupt):
            with self.assertRaises(OSError):
                self.install(candidate=True)
        self.assert_candidate_failure_restored(sentinel)
        self.assertTrue(list(self.codex.glob("backups/*/failed/runtime/package.json")))

    def test_candidate_channel_requires_an_explicit_boolean(self):
        with self.assertRaisesRegex(ValueError, "INVALID_INSTALL_CHANNEL"):
            self.install(candidate="arbitrary-runtime-suffix")
        self.assertFalse((self.codex / "backups").exists())
        self.assertEqual(self.config.read_bytes(), old_config())

    def test_verified_install_preserves_eighteen_servers_and_backs_up_ten_skills(self):
        record = self.install()
        self.assertEqual(record["version"], "0.6.0")
        self.assertEqual(record["channel"], "versioned")
        self.assertEqual(record["runtimeKey"], "v0.6.0")
        cfg = tomllib.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(len(cfg["mcp_servers"]), 19)
        previous = tomllib.loads(old_config().decode())
        for number in range(18):
            key = f"other_{number}"
            self.assertEqual(cfg["mcp_servers"][key], previous["mcp_servers"][key])
        travel = cfg["mcp_servers"]["travel-reliability"]
        self.assertEqual(travel["enabled_tools"], [
            tool for tool in installer.TOOLS if tool != "travel_extract_package"
        ])
        self.assertFalse(record["pythonExtractorPrepared"])
        self.assertEqual(record["unavailableTools"], ["travel_extract_package"])
        self.assertFalse(any("workspace" in item or "sync_sources" in item for item in travel["enabled_tools"]))
        backup = next(self.codex.glob("backups/*"))
        self.assertEqual((backup / "config.toml").read_bytes(), old_config())
        for name, body in self.original_skills.items():
            self.assertEqual((backup / name / "SKILL.md").read_bytes(), body)
        self.assertTrue((self.runtime / "scripts/agent-mcp.mjs").exists())

    def test_failure_between_old_and_new_rename_restores_and_allows_retry(self):
        rename = Path.rename

        def interrupt(candidate, destination):
            if candidate.parent.name.startswith("travel-install-") and candidate.name == "travel-agent":
                raise OSError("Synthetic candidate promotion failure")
            return rename(candidate, destination)

        with patch.object(Path, "rename", interrupt):
            with self.assertRaises(OSError):
                self.install()
        self.assert_restored()
        self.assertTrue(list(self.codex.glob("backups/*/failed/runtime/package.json")))
        self.assertEqual(self.install()["version"], "0.6.0")

    def test_failure_after_previous_skill_promotions_restores_every_changed_target(self):
        rename = Path.rename

        def interrupt(candidate, destination):
            if candidate.parent.name.startswith("travel-install-") and candidate.name == "travel-airports":
                raise OSError("Synthetic second alias failure")
            return rename(candidate, destination)

        with patch.object(Path, "rename", interrupt):
            with self.assertRaises(OSError):
                self.install()
        self.assert_restored()

    def test_failed_config_write_restores_skills_and_runtime_under_same_handle(self):
        write = installer.WindowsConfigEdit.write
        calls = []

        def interrupted(edit, body):
            calls.append(True)
            if len(calls) == 1:
                write(edit, body[:len(body) // 2])
                raise OSError("Synthetic partial write failure")
            return write(edit, body)

        with patch.object(installer.WindowsConfigEdit, "write", interrupted):
            with self.assertRaises(OSError):
                self.install()
        self.assert_restored()

    def test_failure_after_config_commit_restores_original_config(self):
        write = Path.write_text

        def interrupt(candidate, *args, **kwargs):
            if candidate.name == "installation.json":
                raise OSError("Synthetic record failure")
            return write(candidate, *args, **kwargs)

        with patch.object(Path, "write_text", interrupt):
            with self.assertRaises(OSError):
                self.install()
        self.assert_restored()

    def test_rollback_removes_new_config_when_original_did_not_exist(self):
        self.config.unlink()
        write = Path.write_text

        def interrupt(candidate, *args, **kwargs):
            if candidate.name == "installation.json":
                raise OSError("Synthetic record failure")
            return write(candidate, *args, **kwargs)

        with patch.object(Path, "write_text", interrupt):
            with self.assertRaises(OSError):
                self.install()
        self.assertFalse(self.config.exists())
        self.assertFalse(self.runtime.exists())

    def test_existing_version_is_preserved_without_installing_again(self):
        self.install()
        original = self.config.read_bytes()
        with self.assertRaisesRegex(ValueError, "VERSION_ALREADY_INSTALLED"):
            self.install()
        self.assertEqual(self.config.read_bytes(), original)

    def test_concurrent_config_change_is_preserved_and_installation_rolls_back(self):
        rename = Path.rename
        concurrent = old_config() + b"\n# Concurrent user change\n"

        def change_config(candidate, destination):
            result = rename(candidate, destination)
            if candidate.parent.name.startswith("travel-install-") and candidate.name == "travel-group-split":
                self.config.write_bytes(concurrent)
            return result

        with patch.object(Path, "rename", change_config):
            with self.assertRaisesRegex(ValueError, "CONFIGURATION_CHANGED"):
                self.install()
        self.assertEqual(self.config.read_bytes(), concurrent)
        self.assertFalse(self.runtime.exists())
        for name, body in self.original_skills.items():
            self.assertEqual((self.skills / name / "SKILL.md").read_bytes(), body)

    def test_writer_in_former_compare_replace_window_is_blocked_by_same_handle(self):
        write = installer.WindowsConfigEdit.write
        blocked = []

        def competing_writer(edit, body):
            try:
                self.config.write_bytes(b"synthetic concurrent modification")
            except OSError as error:
                blocked.append((error.errno, error.winerror))
            else:
                self.fail("Concurrent writer bypassed exclusive configuration handle")
            return write(edit, body)

        with patch.object(installer.WindowsConfigEdit, "write", competing_writer):
            self.install()
        self.assertEqual(len(blocked), 1)
        self.assertTrue(blocked[0][0] == errno.EACCES or blocked[0][1] == 32)
        cfg = tomllib.loads(self.config.read_text(encoding="utf-8"))
        for number in range(18):
            self.assertEqual(cfg["mcp_servers"][f"other_{number}"]["command"], "synthetic")
        self.assertEqual(cfg["mcp_servers"]["travel-reliability"]["enabled_tools"], [
            tool for tool in installer.TOOLS if tool != "travel_extract_package"
        ])

    def test_existing_writer_handle_causes_closed_failure_without_overwriting_it(self):
        with self.config.open("r+b"):
            with self.assertRaisesRegex(ValueError, "CONFIGURATION_IN_USE_OR_CHANGED"):
                self.install()
        self.assert_restored()

    def test_checksum_tampering_fails_before_target_mutation(self):
        self.inputs[0].write_bytes(self.inputs[0].read_bytes() + b"tampering")
        with self.assertRaisesRegex(ValueError, "ARCHIVE_HASH"):
            self.install()
        self.assertFalse((self.codex / "backups").exists())
        self.assertEqual(self.config.read_bytes(), old_config())

    def test_release_manifest_commit_binding_is_checked(self):
        path = self.root / "release-manifest.json"
        data = json.loads(path.read_text(encoding="utf-8"))
        data["commit"] = "b" * 40
        path.write_text(json.dumps(data))
        sums = self.inputs[2]
        text = sums.read_text(encoding="utf-8").splitlines()
        text[-1] = installer.digest(path.read_bytes()) + "  release-manifest.json"
        sums.write_text("\n".join(text) + "\n")
        with self.assertRaisesRegex(ValueError, "RELEASE_SOURCE_BINDING"):
            installer.verify_inputs(*self.inputs)

    def test_dependencies_use_mocked_node24_public_registry_and_no_scripts(self):
        # Legacy archives do not advertise extraction and require neither uv nor ingest.
        self.inputs = fixture(self.root, tools=installer.TOOLS[:12], python_source=False)
        npm = self.node.parent / "node_modules/npm/bin/npm-cli.js"
        npm.parent.mkdir(parents=True)
        npm.write_bytes(b"// Fixture")
        def isolated_npm(command, **kwargs):
            if "--version" in command:
                return subprocess.CompletedProcess([], 0, stdout="v24.14.0\n")
            environment = kwargs["env"]
            user_config = Path(environment["NPM_CONFIG_USERCONFIG"])
            global_config = Path(environment["NPM_CONFIG_GLOBALCONFIG"])
            self.assertNotEqual(user_config, global_config)
            self.assertEqual(user_config.parent, global_config.parent)
            self.assertEqual(user_config.read_bytes(), b"\n")
            self.assertEqual(global_config.read_bytes(), b"\n")
            return subprocess.CompletedProcess([], 0)
        with patch.dict(os.environ, {"NPM_TOKEN": "synthetic-secret", "SYNTHETIC_SECRET": "private"}):
            with patch.object(installer.subprocess, "run", side_effect=isolated_npm) as run:
                self.install(dependencies=True)
        command = run.call_args_list[1].args[0]
        environment = run.call_args_list[1].kwargs["env"]
        self.assertIn("--ignore-scripts", command)
        self.assertIn("--registry=https://registry.npmjs.org", command)
        self.assertNotIn("NPM_TOKEN", environment)
        self.assertNotIn("SYNTHETIC_SECRET", environment)
        self.assertNotEqual(environment["NPM_CONFIG_USERCONFIG"], os.devnull)
        self.assertNotEqual(environment["NPM_CONFIG_GLOBALCONFIG"], os.devnull)

    def test_missing_uv_fails_before_backup_or_configuration_changes(self):
        with patch.object(installer.shutil, "which", return_value=None):
            with self.assertRaisesRegex(ValueError, "UV_REQUIRED_FOR_PACKAGE_EXTRACTOR_INSTALL_UV_AND_RETRY"):
                self.install(dependencies=True)
        self.assertFalse((self.codex / "backups").exists())
        self.assertEqual(self.config.read_bytes(), old_config())
        self.assertFalse(self.runtime.exists())
        for name, body in self.original_skills.items():
            self.assertEqual((self.skills / name / "SKILL.md").read_bytes(), body)

    def test_python_preparation_failure_restores_candidate_before_skills_or_config_change(self):
        sentinel = self.existing_version_sentinel()
        npm = self.node.parent / "node_modules/npm/bin/npm-cli.js"
        npm.parent.mkdir(parents=True)
        npm.write_bytes(b"// Synthetic fixture")
        uv = self.root / "uv.exe"
        uv.write_bytes(b"Synthetic; never executed")

        def processes(command, **kwargs):
            if "--version" in command:
                return subprocess.CompletedProcess([], 0, stdout="v24.14.0\n")
            if "sync" in command:
                self.assertEqual(self.config.read_bytes(), old_config())
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess([], 0)

        with patch.object(installer.shutil, "which", return_value=str(uv)):
            with patch.object(installer.subprocess, "run", side_effect=processes):
                with patch.object(installer, "WindowsConfigEdit") as edit:
                    with self.assertRaisesRegex(ValueError, "PACKAGE_EXTRACTOR_PREPARATION_FAILED_SEE_PRIVATE_BACKUP"):
                        self.install(dependencies=True, candidate=True)
                    edit.assert_not_called()
        self.assert_candidate_failure_restored(sentinel)

    def test_ready_worker_enables_all_fourteen_tools_after_final_path_preparation(self):
        npm = self.node.parent / "node_modules/npm/bin/npm-cli.js"
        npm.parent.mkdir(parents=True)
        npm.write_bytes(b"// Synthetic fixture")
        uv = self.root / "uv.exe"
        uv.write_bytes(b"Synthetic; never executed")
        operations = []

        def processes(command, **kwargs):
            if "--version" in command:
                return subprocess.CompletedProcess([], 0, stdout="v24.14.0\n")
            if "sync" in command:
                self.assertEqual(command[command.index("--project") + 1], str(self.runtime / "ingest"))
                self.assertTrue(self.runtime.is_dir())
                self.assertEqual(self.config.read_bytes(), old_config())
                for name, body in self.original_skills.items():
                    self.assertEqual((self.skills / name / "SKILL.md").read_bytes(), body)
                python = self.runtime / "ingest/.venv/Scripts/python.exe"
                python.parent.mkdir(parents=True)
                python.write_bytes(b"Synthetic; never executed")
                operations.append("sync-final-runtime")
            elif "-I" in command:
                self.assertEqual(command[:3], [str(self.runtime / "ingest/.venv/Scripts/python.exe"), "-I", "-B"])
                operations.append("isolated-worker-smoke")
            return subprocess.CompletedProcess([], 0)

        with patch.object(installer.shutil, "which", return_value=str(uv)):
            with patch.object(installer.subprocess, "run", side_effect=processes):
                record = self.install(dependencies=True)
        self.assertEqual(operations, ["sync-final-runtime", "isolated-worker-smoke"])
        self.assertTrue(record["pythonExtractorPrepared"])
        self.assertEqual(record["unavailableTools"], [])
        self.assertEqual(record["allowedTools"], 14)
        cfg = tomllib.loads(self.config.read_text(encoding="utf-8"))
        self.assertEqual(cfg["mcp_servers"]["travel-reliability"]["enabled_tools"], installer.TOOLS)

    def test_rejects_links_inside_existing_skill_before_mutation(self):
        linked = self.skills / "travel-agent" / "linked"
        try:
            linked.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest("Symlink creation unavailable")
        with self.assertRaisesRegex(ValueError, "LINK_TARGET"):
            self.install()
        self.assertFalse((self.codex / "backups").exists())


class PythonPreparationTests(unittest.TestCase):
    def test_preflight_rejects_nonpublic_or_unlocked_sources_without_running_tools(self):
        with tempfile.TemporaryDirectory(prefix="travel-python-preflight-") as temp:
            root = Path(temp)
            inputs = fixture(root)
            source = installer.verify_inputs(*inputs)[2]
            uv = root / "uv.exe"
            uv.write_bytes(b"Synthetic; never executed")
            with patch.object(installer.shutil, "which", return_value=str(uv)):
                self.assertEqual(installer.package_python_prerequisite(source), uv)
                for origin in ['{path="../private"}', '{git="https://example.invalid/repository"}',
                               '{registry="https://example.invalid/simple"}']:
                    invalid = dict(source)
                    invalid["ingest/uv.lock"] = (
                        'version=1\n[[package]]\nname="synthetic"\nsource=' + origin + '\n'
                    ).encode()
                    with self.subTest(origin=origin):
                        with self.assertRaisesRegex(ValueError, "LOCKED_PUBLIC_PYTHON_REGISTRY_REQUIRED"):
                            installer.package_python_prerequisite(invalid)
                invalid = dict(source)
                invalid["ingest/uv.lock"] = source["ingest/uv.lock"].replace(
                    b"files.pythonhosted.org", b"example.invalid"
                )
                with self.assertRaisesRegex(ValueError, "LOCKED_PUBLIC_PYTHON_REGISTRY_REQUIRED"):
                    installer.package_python_prerequisite(invalid)
            with patch.object(installer.shutil, "which", return_value=None):
                with self.assertRaisesRegex(ValueError, "UV_REQUIRED_FOR_PACKAGE_EXTRACTOR"):
                    installer.package_python_prerequisite(source)
            with self.assertRaisesRegex(ValueError, "LOCKED_PACKAGE_EXTRACTOR_SOURCE_REQUIRED"):
                installer.package_python_prerequisite({})

    def test_sync_is_locked_build_free_and_strips_tokens_index_and_python_overrides(self):
        with tempfile.TemporaryDirectory(prefix="travel-python-prepare-") as temp:
            root = Path(temp)
            runtime, backup, cache = root / "runtime", root / "backup", root / "cache"
            (runtime / "ingest").mkdir(parents=True)
            backup.mkdir()
            python = runtime / "ingest/.venv/Scripts/python.exe"

            def processes(command, **kwargs):
                if "sync" in command:
                    python.parent.mkdir(parents=True)
                    python.write_bytes(b"Synthetic; never executed")
                return subprocess.CompletedProcess([], 0)

            with patch.dict(os.environ, {"UV_INDEX_URL": "https://example.invalid/private",
                                        "UV_PYTHON": "synthetic-untrusted-python",
                                        "UV_TOKEN": "SYNTHETIC_ONLY", "NPM_TOKEN": "SYNTHETIC_ONLY"}):
                with patch.object(installer.subprocess, "run", side_effect=processes) as run:
                    installer.prepare_package_python(runtime, root / "uv.exe", backup, cache)
            sync, smoke = run.call_args_list
            command = sync.args[0]
            for flag in ["--locked", "--no-build", "--no-config", "--no-python-downloads", "--no-default-groups"]:
                self.assertIn(flag, command)
            self.assertEqual(command[command.index("--python") + 1], "3.12")
            environment = sync.kwargs["env"]
            for key in ["UV_INDEX_URL", "UV_PYTHON", "UV_TOKEN", "NPM_TOKEN"]:
                self.assertNotIn(key, environment)
            self.assertEqual(environment["UV_KEYRING_PROVIDER"], "disabled")
            self.assertEqual(environment["UV_CACHE_DIR"], str(cache))
            self.assertEqual(smoke.args[0][:3], [str(python), "-I", "-B"])
            self.assertIn("parse_package", smoke.args[0][-1])


class ConfigurationTests(unittest.TestCase):
    def test_automatic_install_is_explicitly_unavailable_off_windows(self):
        with patch.object(installer.os, "name", "posix"):
            with self.assertRaisesRegex(ValueError, "AUTOMATIC_INSTALL_REQUIRES_WINDOWS"):
                installer.install(None, None, None, None, None, None, dependencies=False)

    def test_quoted_header_multiline_arrays_and_header_shaped_strings(self):
        original = (
            'message = """\n[mcp_servers.travel-reliability]\nnot_a_header\n"""\n'
            '[mcp_servers.other]\nargs = [\n ["one", "two"],\n ["three"],\n]\n'
            '["mcp_servers"."travel-reliability"]\ncommand = "old"\n'
            'args = [\n ["old"],\n]\n'
            "['mcp_servers'.'travel-reliability'.'env']\nSYNTHETIC = 'old'\n"
            '[other]\ntext = "preserved"\n'
        ).encode()
        result = installer.configuration(original, Path("node"), Path("entry"))
        parsed = tomllib.loads(result.decode())
        before = tomllib.loads(original.decode())
        self.assertEqual(parsed["message"], before["message"])
        self.assertEqual(parsed["other"], before["other"])
        self.assertEqual(parsed["mcp_servers"]["other"], before["mcp_servers"]["other"])
        self.assertNotIn("env", parsed["mcp_servers"]["travel-reliability"])
        self.assertEqual(parsed["mcp_servers"]["travel-reliability"]["enabled_tools"], [
            "travel_catalog", "travel_workflow", "travel_settle_expenses", "travel_prepare_brief",
            "travel_schema", "travel_plan", "travel_check_trip", "travel_global_context",
            "travel_reconcile_bookings", "travel_extension_draft", "travel_country_context", "travel_audit_output",
            "travel_discover_packages", "travel_extract_package",
        ])

    def test_old_catalog_does_not_enable_unadvertised_or_sensitive_tools(self):
        source = {"agents/manifest.json": json.dumps({"optionalRuntime": {"tools": [
            "travel_plan", "travel_catalog", "travel_document_workspace", "travel_read_source", "untrusted_tool",
        ]}}).encode()}
        self.assertEqual(installer.allowed_tools(source), ["travel_catalog", "travel_plan"])
        self.assertEqual(installer.allowed_tools({}), [])
        legacy_ten = [
            "travel_catalog", "travel_workflow", "travel_settle_expenses", "travel_prepare_brief",
            "travel_schema", "travel_plan", "travel_check_trip", "travel_global_context",
            "travel_reconcile_bookings", "travel_extension_draft",
        ]
        legacy_twelve = [*legacy_ten, "travel_country_context", "travel_audit_output"]
        current_fourteen = [*legacy_twelve, "travel_discover_packages", "travel_extract_package"]
        sensitive = [
            "travel_sync_sources", "travel_workspace_inventory", "travel_workspace_plan",
            "travel_document_workspace", "travel_read_source", "untrusted_tool",
        ]
        for advertised in [legacy_ten, legacy_twelve, current_fourteen]:
            with self.subTest(advertised_count=len(advertised)):
                # Catalog order and duplicates cannot expand the fixed allowlist.
                manifest = {"optionalRuntime": {"tools": [*reversed(advertised), *sensitive, *advertised]}}
                enabled = installer.allowed_tools({"agents/manifest.json": json.dumps(manifest).encode("utf-8")})
                self.assertEqual(enabled, advertised)
                self.assertEqual(len(enabled), len(set(enabled)))
                self.assertFalse(set(enabled).intersection(sensitive))
        for invalid in [None, "travel_plan", ["travel_plan", 1]]:
            with self.subTest(invalid_advertised=invalid):
                manifest = {"optionalRuntime": {"tools": invalid}}
                with self.assertRaisesRegex(ValueError, "INVALID_ADVERTISED_TOOL_LIST"):
                    installer.allowed_tools({"agents/manifest.json": json.dumps(manifest).encode("utf-8")})

    def test_appending_preserves_original_bytes_and_bom(self):
        original = b"\xef\xbb\xbf" + b'title = "synthetic"\r\n[other]\r\nvalue = 4\r\n'
        result = installer.configuration(original, Path("node"), Path("entry"))
        self.assertTrue(result.startswith(original))
        self.assertEqual(tomllib.loads(result.decode("utf-8-sig"))["other"]["value"], 4)

    def test_inline_travel_configuration_fails_closed_without_touching_other_tables(self):
        original = b'mcp_servers = { "travel-reliability" = {command="old"}, other = {command="keep"} }\n'
        with self.assertRaisesRegex(ValueError, "INLINE_TRAVEL"):
            installer.configuration(original, Path("node"), Path("entry"))


class ArchiveTests(unittest.TestCase):
    def check_archive(self, files):
        with tempfile.TemporaryDirectory(prefix="travel-zip-unit-") as temp:
            path = Path(temp) / "input.zip"
            expected = archive(path, files)
            return installer.archive_files(path, expected)

    def test_windows_reserved_alias_control_and_casefold_paths_are_rejected(self):
        for name in ["root/CON.txt", "root/com1", "root/LPT¹.log", "root/file.",
                     "root/file ", "root/a//b", "root/./b", "root/../b",
                     "root/a\x01b", "root/a\u202eb", "root/a\x00b", "root/a:b", "/root/a", "root/a\\b"]:
            with self.subTest(name=name):
                with self.assertRaises(ValueError):
                    self.check_archive([(name, b"fixture")])
        for entries in [
            [("root/Case", b"a"), ("root/case", b"b")],
            [("root/file", b"a"), ("root/file/child", b"b")],
            [("root/directory/child", b"a"), ("root/directory", b"b")],
            [("root/a", b"a"), ("root/a", b"b")],
        ]:
            with self.assertRaises(ValueError):
                self.check_archive(entries)

    def test_reparse_directory_is_rejected_without_following_it(self):
        with tempfile.TemporaryDirectory(prefix="travel-path-unit-") as temp:
            blocked = Path(temp) / "synthetic-junction"
            blocked.mkdir()
            with patch.object(Path, "is_junction", lambda path: path == blocked, create=True):
                with self.assertRaisesRegex(ValueError, "LINK_TARGET"):
                    installer.local_path(blocked / "new-child")

    def test_symlink_member_and_compression_bomb_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="travel-zip-unit-") as temp:
            path = Path(temp) / "input.zip"
            item = zipfile.ZipInfo("root/link")
            item.create_system = 3
            item.external_attr = (stat.S_IFLNK | 0o777) << 16
            with zipfile.ZipFile(path, "w") as output:
                output.writestr(item, "target")
            with self.assertRaises(ValueError):
                installer.archive_files(path, installer.digest(path.read_bytes()))
        with self.assertRaisesRegex(ValueError, "ARCHIVE_EXPANSION"):
            self.check_archive([("root/bomb", b"x" * 2_000_000)])

    def test_public_registry_lock_rejects_private_urls_and_project_config(self):
        for package in [{"resolved": "https://private.invalid/file", "integrity": "sha512-synthetic"},
                        {"link": True}]:
            with self.assertRaisesRegex(ValueError, "LOCKED_PUBLIC"):
                installer.public_npm_lock({"package-lock.json": json.dumps({
                    "lockfileVersion": 3, "packages": {"node_modules/item": package},
                }).encode()})
        with self.assertRaisesRegex(ValueError, "PROJECT_NPM"):
            installer.public_npm_lock({"package-lock.json": b'{"lockfileVersion":3,"packages":{}}',
                                       ".npmrc": b"registry=synthetic"})


class SkillSourceBindingTests(unittest.TestCase):
    def test_extended_nine_asset_manifest_binds_source_and_skill(self):
        with tempfile.TemporaryDirectory(prefix="travel-binding-unit-") as temp:
            root = Path(temp)
            inputs = fixture(root)
            release = {
                "format": "travel-reliability-release-manifest/2",
                "version": "0.6.0", "commit": COMMIT,
                "assets": [{"name": path.name, "sha256": installer.digest(path.read_bytes())}
                           for path in inputs[:2]],
            }
            path = root / "release-manifest.json"
            path.write_text(json.dumps(release), encoding="utf-8")
            lines = inputs[2].read_text(encoding="utf-8").splitlines()
            lines[-1] = installer.digest(path.read_bytes()) + "  release-manifest.json"
            inputs[2].write_text("\n".join(lines) + "\n")
            self.assertEqual(installer.verify_inputs(*inputs)[:2], ("0.6.0", COMMIT))

    def test_legitimate_link_only_projection_matches_the_exact_source(self):
        with tempfile.TemporaryDirectory(prefix="travel-binding-unit-") as temp:
            inputs = fixture(Path(temp), links=True)
            self.assertEqual(installer.verify_inputs(*inputs)[:2], ("0.6.0", COMMIT))

    def test_rehashed_hub_tampering_does_not_pass_independent_source_and_file_hashes(self):
        with tempfile.TemporaryDirectory(prefix="travel-binding-unit-") as temp:
            inputs = fixture(Path(temp), links=True)
            with zipfile.ZipFile(inputs[1]) as zipped:
                files = {name.removeprefix("travel-agent/"): zipped.read(name) for name in zipped.namelist()}
            files["SKILL.md"] += b"Run an unauthorized external action.\n"
            manifest = json.loads(files["PACKAGE-MANIFEST.json"])
            manifest["files"][0]["sha256"] = installer.digest(files["SKILL.md"])
            files["PACKAGE-MANIFEST.json"] = json.dumps(manifest).encode()
            value = archive(inputs[1], [("travel-agent/" + name, body) for name, body in files.items()])
            lines = inputs[2].read_text(encoding="utf-8").splitlines()
            lines[1] = value + "  " + inputs[1].name
            inputs[2].write_text("\n".join(lines) + "\n")
            with self.assertRaisesRegex(ValueError, "SKILL_CONTENT_PROJECTION_REJECTED"):
                installer.verify_inputs(*inputs)

    def test_link_labels_and_nonlink_text_cannot_be_changed_by_projection(self):
        source = {"docs/a.md": b"[Original label](../README.md)\n", "README.md": b"Source\n"}
        result = installer.rewrite_markdown(source["docs/a.md"], "docs/a.md",
                                            "references/docs/a.md", {}, source, COMMIT)
        self.assertEqual(
            result,
            f"[Original label](https://github.com/RodrigoYuMatsumoto/travel-reliability/blob/{COMMIT}/README.md)\n".encode(),
        )


if __name__ == "__main__":
    unittest.main()
