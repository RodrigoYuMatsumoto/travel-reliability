"""Container and protocol configuration regressions without starting a daemon."""
import copy
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


def test_profile_matches_pinned_official_bytes_and_retains_default_deny():
    profile = sandbox._profile()
    parsed = json.loads(profile.read_bytes())
    assert parsed["defaultAction"] == "SCMP_ACT_ERRNO"
    assert any(set(item["names"]) == {"clone", "setns", "unshare"} and item["action"] == "SCMP_ACT_ALLOW"
               for item in parsed["syscalls"])


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
