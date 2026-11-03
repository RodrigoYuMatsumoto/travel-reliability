import importlib.util
import errno
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import tomllib
import unittest
from unittest.mock import patch
import zipfile

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


def fixture(root, links=False):
    source = {
        "package.json": json.dumps({"name": "travel-reliability", "version": "0.6.0"}).encode(),
        "package-lock.json": json.dumps({"lockfileVersion": 3, "packages": {}}).encode(),
        "scripts/agent-mcp.mjs": b"// Synthetic fixture, never executed.\n",
        "skills/travel-agent/SKILL.md": b"---\nname: travel-agent\n---\nSynthetic instructions.\n",
    }
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
        self.assertTrue(all(json.loads(path.read_text())["status"] == "RESTORED" for path in records))

    def test_verified_install_preserves_eighteen_servers_and_backs_up_ten_skills(self):
        record = self.install()
        self.assertEqual(record["version"], "0.6.0")
        cfg = tomllib.loads(self.config.read_text())
        self.assertEqual(len(cfg["mcp_servers"]), 19)
        previous = tomllib.loads(old_config().decode())
        for number in range(18):
            key = f"other_{number}"
            self.assertEqual(cfg["mcp_servers"][key], previous["mcp_servers"][key])
        travel = cfg["mcp_servers"]["travel-reliability"]
        self.assertEqual(travel["enabled_tools"], installer.TOOLS)
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
        cfg = tomllib.loads(self.config.read_text())
        for number in range(18):
            self.assertEqual(cfg["mcp_servers"][f"other_{number}"]["command"], "synthetic")
        self.assertEqual(cfg["mcp_servers"]["travel-reliability"]["enabled_tools"], installer.TOOLS)

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
        data = json.loads(path.read_text())
        data["commit"] = "b" * 40
        path.write_text(json.dumps(data))
        sums = self.inputs[2]
        text = sums.read_text().splitlines()
        text[-1] = installer.digest(path.read_bytes()) + "  release-manifest.json"
        sums.write_text("\n".join(text) + "\n")
        with self.assertRaisesRegex(ValueError, "RELEASE_SOURCE_BINDING"):
            installer.verify_inputs(*self.inputs)

    def test_dependencies_use_mocked_node24_public_registry_and_no_scripts(self):
        npm = self.node.parent / "node_modules/npm/bin/npm-cli.js"
        npm.parent.mkdir(parents=True)
        npm.write_bytes(b"// Fixture")
        with patch.dict(os.environ, {"NPM_TOKEN": "synthetic-secret", "SYNTHETIC_SECRET": "private"}):
            with patch.object(installer.subprocess, "run", side_effect=[
                subprocess.CompletedProcess([], 0, stdout="v24.14.0\n"),
                subprocess.CompletedProcess([], 0),
            ]) as run:
                self.install(dependencies=True)
        command = run.call_args_list[1].args[0]
        environment = run.call_args_list[1].kwargs["env"]
        self.assertIn("--ignore-scripts", command)
        self.assertIn("--registry=https://registry.npmjs.org", command)
        self.assertNotIn("NPM_TOKEN", environment)
        self.assertNotIn("SYNTHETIC_SECRET", environment)
        self.assertEqual(environment["NPM_CONFIG_USERCONFIG"], os.devnull)
        self.assertEqual(environment["NPM_CONFIG_GLOBALCONFIG"], os.devnull)

    def test_rejects_links_inside_existing_skill_before_mutation(self):
        linked = self.skills / "travel-agent" / "linked"
        try:
            linked.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest("Symlink creation unavailable")
        with self.assertRaisesRegex(ValueError, "LINK_TARGET"):
            self.install()
        self.assertFalse((self.codex / "backups").exists())


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
        self.assertEqual(len(parsed["mcp_servers"]["travel-reliability"]["enabled_tools"]), 10)

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
            lines = inputs[2].read_text().splitlines()
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
            lines = inputs[2].read_text().splitlines()
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
