"""Container and protocol configuration regressions without starting a daemon."""
import copy
import hashlib
import json
from pathlib import Path

import pytest

from travel_ingest.packages import PackageError
from travel_ingest.packages import render_sandbox as sandbox

IMAGE = "sha256:" + "a" * 64
NAME = "tr-render-" + "b" * 32


def inspected_container():
    return {
        "Image": IMAGE,
        "Config": {"User": "10001:10001", "Entrypoint": ["python3", "-I", "-B", "/app/render_worker.py"],
                   "Cmd": [], "Labels": {"org.travel-reliability.renderer": sandbox.PROTOCOL}},
        "Mounts": [],
        "HostConfig": {"NetworkMode": "none", "ReadonlyRootfs": True, "Privileged": False,
                       "CapAdd": [], "CapDrop": ["ALL"], "Binds": [], "PortBindings": {},
                       "PublishAllPorts": False, "Devices": [], "DeviceRequests": [],
                       "PidMode": "", "IpcMode": "private", "UTSMode": "", "Init": True,
                       "PidsLimit": 128, "Memory": sandbox.MEMORY_BYTES,
                       "MemorySwap": sandbox.MEMORY_BYTES, "NanoCpus": 1_000_000_000,
                       "ShmSize": 268435456,
                       "SecurityOpt": ["no-new-privileges=true", "seccomp=" + json.dumps(json.loads(sandbox._profile().read_bytes()))],
                       "Tmpfs": {"/tmp": "bounded", "/home/renderer": "bounded"}},
    }


def test_actual_daemon_configuration_must_match_no_network_contract():
    sandbox.validate_container(inspected_container(), IMAGE)


@pytest.mark.parametrize("field,value", [
    ("NetworkMode", "bridge"), ("NetworkMode", "host"), ("ReadonlyRootfs", False),
    ("Privileged", True), ("CapAdd", ["SYS_ADMIN"]), ("CapDrop", []),
    ("Binds", ["/synthetic-private:/mnt"]), ("PortBindings", {"8080/tcp": [{}]}),
    ("PidMode", "host"), ("IpcMode", "host"), ("UTSMode", "host"),
    ("Devices", [{"PathOnHost": "/synthetic"}]), ("DeviceRequests", [{}]),
    ("PidsLimit", 0), ("Memory", 0), ("MemorySwap", -1), ("NanoCpus", 0),
    ("SecurityOpt", ["no-new-privileges=true", "seccomp=unconfined"]),
    ("SecurityOpt", ["no-new-privileges=true", 'seccomp={"defaultAction":"SCMP_ACT_ALLOW"}']),
    ("Tmpfs", {"/tmp": "bounded", "/home/renderer": "bounded", "/mnt": "unsafe"}),
    ("Init", False),
])
def test_drift_in_effective_daemon_security_configuration_is_rejected(field, value):
    observed = inspected_container()
    observed["HostConfig"][field] = value
    with pytest.raises(PackageError, match="RENDER_CONTAINER_ISOLATION_INVALID"):
        sandbox.validate_container(observed, IMAGE)


@pytest.mark.parametrize("field,value", [("User", "0"), ("Entrypoint", ["sh", "-c"]), ("Cmd", ["arbitrary"]),
                                         ("Labels", {})])
def test_effective_process_identity_and_fixed_entrypoint_are_required(field, value):
    observed = inspected_container()
    observed["Config"][field] = value
    with pytest.raises(PackageError):
        sandbox.validate_container(observed, IMAGE)


def test_inspection_rejects_hidden_mounts_and_other_image_identity():
    observed = inspected_container()
    observed["Mounts"] = [{"Source": "/synthetic"}]
    with pytest.raises(PackageError):
        sandbox.validate_container(observed, IMAGE)
    with pytest.raises(PackageError):
        sandbox.validate_container(inspected_container(), "sha256:" + "c" * 64)


def test_commands_use_immutable_image_no_host_namespace_or_path_mount():
    command = sandbox.container_arguments(IMAGE, NAME, Path("synthetic-seccomp.json"))
    assert command[-1] == IMAGE
    assert command[command.index("--network") + 1] == "none"
    assert command[command.index("--ipc") + 1] == "private"
    assert not {"--privileged", "--cap-add", "--volume", "-v", "--mount", "--publish", "-p"}.intersection(command)
    with pytest.raises(PackageError):
        sandbox.container_arguments("mutable:latest", NAME, Path("profile.json"))


def test_host_environment_drops_cloud_keys_docker_context_proxy_and_python_hooks(monkeypatch):
    for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "HTTPS_PROXY", "HTTP_PROXY",
                "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "PYTHONPATH", "PYTHONSTARTUP", "NODE_OPTIONS"):
        monkeypatch.setenv(key, "SYNTHETIC_ONLY")
        assert key not in sandbox._environment()


def test_profile_matches_pinned_derivation_and_retains_default_deny():
    profile = sandbox._profile()
    parsed = json.loads(profile.read_bytes())
    upstream_bytes = (profile.parent / "seccomp_upstream.json").read_bytes()
    upstream = json.loads(upstream_bytes)
    provenance = json.loads((profile.parent / "provenance.json").read_bytes())
    assert hashlib.sha256(upstream_bytes).hexdigest() == provenance["seccompUpstreamSha256"]
    assert hashlib.sha256(profile.read_bytes()).hexdigest() == provenance["seccompSha256"]
    assert provenance["seccompDerivation"]["outerCapabilitiesAdded"] is False
    derived = copy.deepcopy(upstream)
    removed = {"socket", "socketpair", "socketcall", "io_uring_setup", "io_uring_enter", "io_uring_register"}
    assert set(provenance["seccompDerivation"]["removedAllowSyscalls"]) == removed
    for rule in derived["syscalls"]:
        if rule["action"] == "SCMP_ACT_ALLOW":
            rule["names"] = [name for name in rule["names"] if name not in removed]
    derived["syscalls"] = [rule for rule in derived["syscalls"] if rule["names"]]
    appended = provenance["seccompDerivation"]["appendedRules"]
    assert len(appended) == 6
    derived["syscalls"].extend(appended)
    assert parsed == derived
    assert appended[0]["names"] == ["chroot"]
    assert appended[0]["includes"] == {}
    assert any(item["names"] == ["chroot"] and item.get("includes", {}).get("caps") == ["CAP_SYS_CHROOT"]
               for item in upstream["syscalls"])
    assert parsed["defaultAction"] == "SCMP_ACT_ERRNO"
    assert any(set(item["names"]) == {"clone", "setns", "unshare"} and item["action"] == "SCMP_ACT_ALLOW"
               for item in parsed["syscalls"])


def test_profile_disallows_non_namespaced_socket_families_legacy_multiplexer_and_io_uring():
    profile = json.loads(sandbox._profile().read_bytes())
    rules = [rule for rule in profile["syscalls"] if rule["action"] == "SCMP_ACT_ALLOW"]
    for forbidden in ("socketcall", "io_uring_setup", "io_uring_enter", "io_uring_register"):
        assert not any(forbidden in rule["names"] for rule in rules)
    sockets = [rule for rule in rules if "socket" in rule["names"]]
    assert len(sockets) == 4
    assert {rule["args"][0]["value"] for rule in sockets} == {1, 2, 10, 16}
    assert all(rule["names"] == ["socket"] and len(rule["args"]) == 1 and
               rule["args"][0]["index"] == 0 and rule["args"][0]["op"] == "SCMP_CMP_EQ" for rule in sockets)
    pairs = [rule for rule in rules if "socketpair" in rule["names"]]
    assert len(pairs) == 1
    assert pairs[0]["args"] == [{"index": 0, "value": 1, "op": "SCMP_CMP_EQ"}]


def test_missing_operator_image_fails_before_policy_dns_docker_or_any_external_read(monkeypatch):
    monkeypatch.delenv("TRAVEL_RELIABILITY_RENDERER_IMAGE", raising=False)
    def forbidden(*args, **kwargs):
        raise AssertionError("EXTERNAL_ACTION_BEFORE_IMAGE_VALIDATION")
    monkeypatch.setattr(sandbox, "_docker", forbidden)
    monkeypatch.setattr(sandbox, "RenderPolicy", forbidden)
    with pytest.raises(PackageError, match="RENDER_IMMUTABLE_IMAGE_REQUIRED"):
        sandbox.render_isolated("https://augustusturismo.com.br/#/pacote/synthetic")


def test_inspection_never_mutates_observed_configuration():
    observed = inspected_container()
    original = copy.deepcopy(observed)
    sandbox.validate_container(observed, IMAGE)
    assert observed == original


@pytest.mark.parametrize("message,expected", [
    ("pthread_create: Operation not permitted", "RENDER_THREAD_CREATION_DENIED"),
    ("Failed to move to new namespace: Operation not permitted", "RENDER_CHROMIUM_SANDBOX_UNAVAILABLE"),
    ("Executable doesn't exist at synthetic path", "RENDER_BROWSER_EXECUTABLE_MISSING"),
    ("Permission denied with synthetic sensitive text", "RENDER_PROCESS_PERMISSION_DENIED"),
    ("Unexpected failure with synthetic sensitive text", "RENDER_BOOTSTRAP_FAILED"),
])
def test_worker_startup_diagnostics_return_only_fixed_codes_without_raw_text(monkeypatch, message, expected):
    from travel_ingest.packages import render_worker
    monkeypatch.setattr(render_worker, "_clone_errno", lambda: "UNSUPPORTED")
    result = render_worker.safe_error_code(RuntimeError(message))
    assert result == expected
    assert "synthetic" not in result


@pytest.mark.parametrize("number,label", [(1, "EPERM"), (38, "ENOSYS"), (22, "EINVAL"), (14, "EFAULT"), (999, "OTHER")])
def test_clone_probe_has_only_null_arguments_and_reports_fixed_errno_enums(monkeypatch, number, label):
    from travel_ingest.packages import render_worker
    class Syscall:
        def __call__(self, number, pointer, size):
            assert (number, pointer, size) == (435, None, 0)
            return -1
    class Library:
        syscall = Syscall()
    monkeypatch.setattr(render_worker, "_supports_clone_probe", lambda: True)
    monkeypatch.setattr(render_worker.ctypes, "CDLL", lambda value, use_errno: Library())
    monkeypatch.setattr(render_worker.ctypes, "get_errno", lambda: number)
    assert render_worker._clone_errno() == label


def test_clone_probe_exception_and_unsupported_platform_are_nonfatal_and_do_not_create_processes(monkeypatch):
    from travel_ingest.packages import render_worker
    def forbidden(*args, **kwargs):
        raise OSError("Synthetic failure with private diagnostic")
    monkeypatch.setattr(render_worker.ctypes, "CDLL", forbidden)
    monkeypatch.setattr(render_worker, "_supports_clone_probe", lambda: False)
    assert render_worker._clone_errno() == "UNSUPPORTED"
    monkeypatch.setattr(render_worker, "_supports_clone_probe", lambda: True)
    assert render_worker._clone_errno() == "UNAVAILABLE"


@pytest.mark.parametrize("observed", ["EPERM", "ENOSYS", "EINVAL", "EFAULT"])
def test_only_startup_thread_errors_attach_observed_clone_errno(monkeypatch, observed):
    from travel_ingest.packages import render_worker
    monkeypatch.setattr(render_worker, "STAGE", "BROWSER_LAUNCH")
    monkeypatch.setattr(render_worker, "_clone_errno", lambda: observed)
    assert render_worker.safe_error_code(RuntimeError("pthread_create: synthetic")) == "RENDER_THREAD_CREATION_DENIED_CLONE_" + observed
    monkeypatch.setattr(render_worker, "STAGE", "DOCUMENT_NAVIGATION")
    assert render_worker.safe_error_code(RuntimeError("pthread_create: synthetic")) == "RENDER_THREAD_CREATION_DENIED"
