"""Immutable local Docker browser with no network; all reads pass through a host broker."""
from __future__ import annotations

import hashlib
import json
import os
import queue
import re
import shutil
import subprocess  # nosec B404 - Fixed local Docker executable; no shell or page-controlled commands.
import tempfile
import threading
import time
import uuid
from pathlib import Path

from .common import MAX_HTML_BYTES
from .errors import PackageError
from .fetch import USER_AGENT, same_document
from .render_broker import ResourceBroker
from .render_policy import PROTOCOL, RenderPolicy

MAX_PROTOCOL_LINE = 8 * 1024 * 1024
MAX_PROTOCOL_TOTAL = 12 * 1024 * 1024
MEMORY_BYTES = 1024 * 1024 * 1024
PROFILE_SHA256 = "cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849"


def _environment() -> dict:
    return {name: value for name, value in os.environ.items()
            if name.upper() in {"PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT"}}


def _docker(executable: str | None = None) -> str:
    found = executable or shutil.which("docker")
    if not found or not Path(found).is_absolute() or not Path(found).is_file():
        raise PackageError("RENDER_DOCKER_REQUIRED")
    return str(Path(found).resolve())


def _daemon() -> str:
    return "npipe:////./pipe/docker_engine" if os.name == "nt" else "unix:///var/run/docker.sock"


def _profile() -> Path:
    location = Path(__file__).resolve().parents[3] / "deploy/renderer/seccomp_chromium.json"
    if (not location.is_file() or location.is_symlink()
            or hashlib.sha256(location.read_bytes()).hexdigest() != PROFILE_SHA256):
        raise PackageError("RENDER_SECCOMP_PROFILE_INVALID")
    return location


def container_arguments(image: str, name: str, profile: Path) -> list[str]:
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise PackageError("RENDER_IMMUTABLE_IMAGE_REQUIRED")
    if not re.fullmatch(r"tr-render-[a-f0-9]{32}", name):
        raise PackageError("RENDER_CONTAINER_ID_INVALID")
    return ["create", "--name", name, "--pull", "never", "--network", "none", "--read-only",
            "--user", "10001:10001", "--cap-drop", "ALL", "--security-opt", "no-new-privileges=true",
            "--security-opt", "seccomp=" + str(profile), "--pids-limit", "128", "--memory", str(MEMORY_BYTES),
            "--memory-swap", str(MEMORY_BYTES), "--cpus", "1", "--ipc", "private", "--shm-size", "256m",
            "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=268435456,mode=1777",  # nosec B108 - Container-only bounded tmpfs declaration, not a host temporary path.
            "--tmpfs", "/home/renderer:rw,noexec,nosuid,nodev,size=67108864,uid=10001,gid=10001,mode=700",
            "--ulimit", "nofile=1024:1024", "--init", "-i", image]


def validate_container(value: dict, image: str) -> None:
    """Assert actual daemon configuration, rather than trusting CLI argument spelling."""
    try:
        host = value["HostConfig"]
        config = value["Config"]
        security = host["SecurityOpt"]
        seccomp = [item.removeprefix("seccomp=") for item in security if item.startswith("seccomp=")]
        if len(security) != 2 or len(seccomp) != 1 or json.loads(seccomp[0]) != json.loads(_profile().read_bytes()):
            raise ValueError
        if (value["Image"] != image or config["User"] != "10001:10001"
                or config["Entrypoint"] != ["python3", "-I", "-B", "/app/render_worker.py"]
                or config.get("Cmd") not in (None, [])
                or host["NetworkMode"] != "none" or not host["ReadonlyRootfs"]
                or host["Privileged"] or host.get("CapAdd") or host["CapDrop"] != ["ALL"]
                or host.get("Binds") or value.get("Mounts") or host.get("PortBindings")
                or host.get("PublishAllPorts") or host.get("Devices") or host.get("DeviceRequests")
                or host.get("PidMode") or host.get("IpcMode") != "private" or host.get("UTSMode")
                or host["PidsLimit"] != 128 or host["Memory"] != MEMORY_BYTES
                or host["MemorySwap"] != MEMORY_BYTES or host["NanoCpus"] != 1_000_000_000
                or host.get("Init") is not True or host["ShmSize"] != 268435456
                or "no-new-privileges=true" not in security
                or set(host["Tmpfs"]) != {"/tmp", "/home/renderer"}  # nosec B108 - Inspect expected container mount points; no host filesystem access.
                or config.get("Labels", {}).get("org.travel-reliability.renderer") != PROTOCOL):
            raise ValueError
    except (ValueError, KeyError, TypeError, AttributeError):
        raise PackageError("RENDER_CONTAINER_ISOLATION_INVALID") from None


def _run(command: list[str], environment: dict, timeout: float, *, maximum=2 * 1024 * 1024):
    try:
        # Inputs are trusted fixed commands, immutable image IDs and generated IDs, never page data.
        value = subprocess.run(command, env=environment, capture_output=True, check=True, timeout=timeout, shell=False)  # nosec B603 - Internal fixed Docker subcommands, validated absolute executable/image ID; no page data.
        if len(value.stdout) > maximum:
            raise ValueError
        return value.stdout
    except (subprocess.SubprocessError, OSError, ValueError):
        raise PackageError("RENDER_DOCKER_UNAVAILABLE") from None


def run_isolated(policy: RenderPolicy, broker: ResourceBroker, *, image: str,
                 docker: str | None = None, timeout_ms: int = 30000,
                 max_bytes: int = MAX_HTML_BYTES, user_agent: str = USER_AGENT) -> dict:
    """Trusted-code test seam: production constructs its own policy and broker below."""
    if type(timeout_ms) is not int or not 1000 <= timeout_ms <= 60000:
        raise PackageError("RENDER_BUDGET_INVALID")
    if type(max_bytes) is not int or not 1 <= max_bytes <= MAX_HTML_BYTES:
        raise PackageError("RENDER_BUDGET_INVALID")
    executable = _docker(docker)
    profile = _profile()
    name = "tr-render-" + uuid.uuid4().hex
    arguments = container_arguments(image, name, profile)
    environment = _environment()
    deadline = min(broker.deadline, time.monotonic() + timeout_ms / 1000)
    process = None
    watchdog = None
    created = False
    messages = queue.Queue(maxsize=2)
    total = 0

    def remaining() -> float:
        value = deadline - time.monotonic()
        if value <= 0:
            raise PackageError("RENDER_DEADLINE")
        return value

    with tempfile.TemporaryDirectory(prefix="tr-render-config-") as owned_config:
        Path(owned_config, "config.json").write_text("{}\n", encoding="utf-8")
        base = [executable, "--host", _daemon(), "--config", owned_config]
        try:
            # No caller-provided Docker context, remote daemon, auth config or host volumes.
            inspected = json.loads(_run(base + ["image", "inspect", image], environment, remaining()))
            if (not isinstance(inspected, list) or len(inspected) != 1 or inspected[0].get("Id") != image
                    or inspected[0].get("Config", {}).get("Labels", {}).get("org.travel-reliability.renderer") != PROTOCOL):
                raise PackageError("RENDER_IMMUTABLE_IMAGE_REQUIRED")
            _run(base + arguments, environment, remaining())
            created = True
            container = json.loads(_run(base + ["inspect", name], environment, remaining()))
            if not isinstance(container, list) or len(container) != 1:
                raise PackageError("RENDER_CONTAINER_ISOLATION_INVALID")
            validate_container(container[0], image)
            process = subprocess.Popen(base + ["start", "--attach", "--interactive", name],  # nosec B603 - Fixed Docker start with generated owned container name; pages cross only bounded stdin JSON.
                                       env=environment, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.DEVNULL, shell=False)
            # A compromised worker could stop reading stdin. The absolute watchdog
            # interrupts blocked writes as well as normal protocol waits.
            watchdog = threading.Timer(remaining(), process.kill)
            watchdog.daemon = True
            watchdog.start()

            def read_stdout():
                nonlocal total
                try:
                    while True:
                        raw = process.stdout.readline(MAX_PROTOCOL_LINE + 1)
                        total += len(raw)
                        if not raw or not raw.endswith(b"\n") or len(raw) > MAX_PROTOCOL_LINE or total > MAX_PROTOCOL_TOTAL:
                            messages.put(("error", "RENDER_PROTOCOL_LIMIT"), timeout=1)
                            return
                        value = json.loads(raw)
                        if not isinstance(value, dict):
                            raise ValueError
                        messages.put(("message", value), timeout=1)
                except Exception:
                    try:
                        messages.put(("error", "RENDER_PROTOCOL_INVALID"), timeout=1)
                    except queue.Full:
                        pass

            threading.Thread(target=read_stdout, daemon=True, name="render-protocol").start()

            def send(value):
                raw = (json.dumps(value, separators=(",", ":"), ensure_ascii=True) + "\n").encode("utf-8")
                if len(raw) > MAX_PROTOCOL_LINE:
                    raise PackageError("RENDER_PROTOCOL_LIMIT")
                process.stdin.write(raw)
                process.stdin.flush()

            send({"protocol": PROTOCOL, "url": policy.target, "timeoutMs": int(remaining() * 1000),
                  "maxBytes": max_bytes, "userAgent": user_agent})
            ready = False
            sequence = 0
            while True:
                try:
                    kind, value = messages.get(timeout=remaining())
                except queue.Empty:
                    raise PackageError("RENDER_DEADLINE") from None
                if kind != "message":
                    raise PackageError(value)
                if value.get("type") == "ready" and not ready:
                    if (set(value) != {"type", "protocol", "uid", "interfaces", "chromiumSandbox"}
                            or value["protocol"] != PROTOCOL or value["uid"] != 10001
                            or value["interfaces"] != ["lo"] or value["chromiumSandbox"] is not True):
                        raise PackageError("RENDER_CONTAINER_ISOLATION_INVALID")
                    ready = True
                elif value.get("type") == "request" and ready:
                    sequence += 1
                    if (set(value) != {"type", "id", "url", "method", "kind", "navigation"}
                            or type(value["id"]) is not int or value["id"] != sequence or sequence > 48
                            or type(value["navigation"]) is not bool):
                        raise PackageError("RENDER_PROTOCOL_INVALID")
                    try:
                        reply = broker.fetch(value["url"], kind=value["kind"], method=value["method"],
                                             navigation=value["navigation"])
                        send({"id": sequence, **reply})
                    except PackageError as error:
                        if error.code != "RENDER_RESOURCE_DENIED":
                            raise
                        send({"id": sequence, "blocked": True})
                elif value.get("type") == "result" and ready:
                    if (set(value) != {"type", "html", "finalUrl", "requests", "blocked"}
                            or not isinstance(value["html"], str) or not isinstance(value["finalUrl"], str)
                            or len(value["html"].encode("utf-8")) > max_bytes
                            or not same_document(policy.target, value["finalUrl"])):
                        raise PackageError("RENDER_RESULT_INVALID")
                    broker.require_complete()
                    return {"html": value["html"], "finalUrl": value["finalUrl"],
                            "isolation": {"protocol": PROTOCOL, "image": image, "network": "none",
                                          "uid": 10001, "chromiumSandbox": True, "readOnlyRootfs": True,
                                          "blockedBrowserRequests": value["blocked"]},
                            "provenance": broker.receipt()}
                elif value.get("type") == "error":
                    code = value.get("code")
                    raise PackageError(code if isinstance(code, str) and re.fullmatch(r"RENDER_[A-Z_]{1,70}", code)
                                       else "RENDER_BROWSER_FAILED")
                else:
                    raise PackageError("RENDER_PROTOCOL_INVALID")
        except PackageError:
            raise
        except (ValueError, TypeError, OSError, subprocess.SubprocessError):
            raise PackageError("RENDER_FAILED") from None
        finally:
            if watchdog is not None:
                watchdog.cancel()
            if process is not None:
                try:
                    process.stdin.close()
                except OSError:
                    pass
                if process.poll() is None:
                    process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=3)
            if created:
                # Exact generated container name only. No prune, wildcard or unrelated process stop.
                _run(base + ["rm", "--force", name], environment, 8)


def render_isolated(url: str, *, user_agent: str = USER_AGENT, timeout_ms: int = 30000,
                    max_bytes: int = MAX_HTML_BYTES) -> dict:
    image = os.environ.get("TRAVEL_RELIABILITY_RENDERER_IMAGE", "")
    if not re.fullmatch(r"sha256:[a-f0-9]{64}", image):
        raise PackageError("RENDER_IMMUTABLE_IMAGE_REQUIRED")
    policy = RenderPolicy(url)
    broker = ResourceBroker(policy, deadline=time.monotonic() + timeout_ms / 1000)
    return run_isolated(policy, broker, image=image, timeout_ms=timeout_ms,
                        max_bytes=max_bytes, user_agent=user_agent)
