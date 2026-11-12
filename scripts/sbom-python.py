"""Offline CycloneDX inventory from declared Python locks and renderer provenance."""
from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path
from urllib.parse import quote, urlsplit


def bounded(path: Path, maximum=5 * 1024 * 1024) -> bytes:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > maximum:
        raise ValueError("SBOM_SOURCE_REJECTED")
    return path.read_bytes()


def identity(name, version):
    if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,150}", name):
        raise ValueError("SBOM_PYTHON_IDENTITY_REJECTED")
    if not isinstance(version, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]{0,100}", version):
        raise ValueError("SBOM_PYTHON_IDENTITY_REJECTED")
    normalized = re.sub(r"[-_.]+", "-", name).lower()
    return normalized, version, f"pkg:pypi/{normalized}@{quote(version, safe='')}"


def inventory(root: Path) -> dict:
    components, dependencies, roots = {}, {}, []
    usages: dict[str, set[str]] = {}

    def package(name, version, hashes, usage):
        name, version, reference = identity(name, version)
        if not hashes or any(not re.fullmatch(r"[a-f0-9]{64}", value) for value in hashes):
            raise ValueError("SBOM_PACKAGE_HASH_REQUIRED")
        component = components.setdefault(reference, {"type": "library", "name": name, "version": version,
                                                     "bom-ref": reference, "purl": reference, "hashes": []})
        combined = sorted({value["content"] for value in component["hashes"]} | set(hashes))
        component["hashes"] = [{"alg": "SHA-256", "content": value} for value in combined]
        usages.setdefault(reference, set()).add(usage)
        dependencies.setdefault(reference, set())
        return reference

    locked_path = root / "ingest/uv.lock"
    if locked_path.exists():
        locked = tomllib.loads(bounded(locked_path).decode("utf-8"))
        packages = locked.get("package")
        if not isinstance(packages, list) or not packages:
            raise ValueError("SBOM_LOCK_INVALID")
        projects = [item for item in packages if item.get("source") == {"virtual": "."}]
        if len(projects) != 1:
            raise ValueError("SBOM_LOCK_ROOT_INVALID")
        virtual = projects[0]
        project_name, project_version, _ = identity(virtual["name"], virtual["version"])
        context = "urn:travel-reliability:ingest-lock"
        components[context] = {"type": "application", "name": project_name, "version": project_version,
                               "bom-ref": context, "properties": [{"name": "travel-reliability:source-kind",
                                                                      "value": "virtual local project; registry publication is not asserted"}]}
        dependencies[context] = set()
        roots.append(context)
        indexed = {}
        for item in packages:
            if item is virtual:
                continue
            if item.get("source") != {"registry": "https://pypi.org/simple"}:
                raise ValueError("SBOM_PUBLIC_PYPI_LOCK_REQUIRED")
            name, version, _ = identity(item["name"], item["version"])
            artifacts = list(item.get("wheels", [])) + ([item["sdist"]] if item.get("sdist") else [])
            hashes = []
            for artifact in artifacts:
                url = urlsplit(artifact.get("url", ""))
                digest = artifact.get("hash", "")
                if (url.scheme != "https" or url.hostname != "files.pythonhosted.org"
                        or url.username is not None or url.password is not None or url.port is not None
                        or url.query or url.fragment or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest)):
                    raise ValueError("SBOM_PUBLIC_PYPI_LOCK_REQUIRED")
                hashes.append(digest.removeprefix("sha256:"))
            reference = package(name, version, hashes, "ingest-locked")
            if (name, version) in indexed:
                raise ValueError("SBOM_DUPLICATE_LOCK_IDENTITY")
            indexed[name, version] = (reference, item)

        def resolve(dependency):
            name = identity(dependency["name"], dependency.get("version", "0"))[0]
            matches = [value[0] for (key, version), value in indexed.items()
                       if key == name and (not dependency.get("version") or version == dependency["version"])]
            if len(matches) != 1:
                raise ValueError("SBOM_LOCK_REFERENCE_INVALID")
            return matches[0]

        for reference, item in indexed.values():
            children = list(item.get("dependencies", []))
            for group in item.get("optional-dependencies", {}).values():
                children.extend(group)
            dependencies[reference].update(resolve(value) for value in children)
        runtime = {resolve(value) for value in virtual.get("dependencies", [])}
        development = {resolve(value) for values in virtual.get("dev-dependencies", {}).values() for value in values}
        dependencies[context].update(runtime | development)

        def classify(initial, label):
            visited, pending = set(), list(initial)
            while pending:
                reference = pending.pop()
                if reference in visited:
                    continue
                visited.add(reference)
                usages[reference].add(label)
                pending.extend(dependencies[reference] - visited)
        classify(runtime, "ingest-runtime")
        classify(development, "ingest-development")

    requirements = root / "deploy/renderer/requirements.txt"
    provenance = root / "deploy/renderer/provenance.json"
    if requirements.exists() != provenance.exists():
        raise ValueError("SBOM_RENDERER_INVENTORY_INCOMPLETE")
    if requirements.exists():
        declared = json.loads(bounded(provenance, 100000))
        physical = bounded(requirements, 100000).decode("utf-8").replace("\r\n", "\n")
        logical = " ".join(physical.split("\\\n")).splitlines()
        pinned = {}
        for line in logical:
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            match = re.fullmatch(r"\s*([A-Za-z0-9_.-]+)==([A-Za-z0-9.!+_-]+)((?:\s+--hash=sha256:[a-f0-9]{64})+)\s*", line)
            if not match:
                raise ValueError("SBOM_RENDERER_PIN_REQUIRED")
            name, version, reference = identity(match[1], match[2])
            if name in pinned:
                raise ValueError("SBOM_DUPLICATE_RENDERER_PIN")
            hashes = re.findall(r"--hash=sha256:([a-f0-9]{64})", match[3])
            pinned[name] = (version, reference)
            package(name, version, hashes, "renderer-pinned")
        expected = {identity(row["package"], row["version"])[0:2] for row in declared["dependencies"]}
        if not pinned or {(name, value[0]) for name, value in pinned.items()} != expected:
            raise ValueError("SBOM_RENDERER_PROVENANCE_MISMATCH")
        context = "urn:travel-reliability:renderer-pins"
        components[context] = {"type": "application", "name": "travel-reliability-renderer-pins", "bom-ref": context,
                               "properties": [{"name": "travel-reliability:graph-scope",
                                                "value": "Flat hash-pinned Python set; transitive dependency edges are not inferred"}]}
        roots.append(context)
        dependencies[context] = {value[1] for value in pinned.values()}
        image = declared.get("baseImage", "")
        match = re.fullmatch(r"mcr\.microsoft\.com/playwright/python:(v[0-9.]+-noble)@sha256:([a-f0-9]{64})", image)
        if not match:
            raise ValueError("SBOM_RENDERER_IMAGE_DIGEST_REQUIRED")
        image_ref = "urn:travel-reliability:renderer-base:sha256:" + match[2]
        components[image_ref] = {"type": "container", "name": "mcr.microsoft.com/playwright/python",
                                  "version": match[1], "bom-ref": image_ref,
                                  "purl": "pkg:oci/python@sha256%3A" + match[2] + "?repository_url=mcr.microsoft.com%2Fplaywright%2Fpython&tag=" + match[1],
                                  "hashes": [{"alg": "SHA-256", "content": match[2]}],
                                  "properties": [{"name": "travel-reliability:image-reference", "value": image},
                                                 {"name": "travel-reliability:image-inventory-scope", "value": "Pinned OCI index only; OS/browser package contents are not enumerated"}]}
        dependencies[image_ref] = set()
        dependencies[context].add(image_ref)

    for reference, labels in usages.items():
        components[reference]["properties"] = [{"name": "travel-reliability:python-usage", "value": ",".join(sorted(labels))}]
        components[reference]["scope"] = "optional" if "ingest-runtime" not in labels else "required"
    return {"format": "travel-reliability-python-inventory/1", "roots": roots,
            "components": [components[key] for key in sorted(components)],
            "dependencies": [{"ref": key, "dependsOn": sorted(dependencies[key])} for key in sorted(dependencies)],
            "properties": [{"name": "travel-reliability:inventory-scope",
                             "value": "npm graph plus declared Python lock graph (runtime/dev and unevaluated markers), renderer hash pins and OCI base index; not an installed-environment or complete OS inventory"}]}


if __name__ == "__main__":
    try:
        print(json.dumps(inventory(Path(__file__).resolve().parents[1]), separators=(",", ":")))
    except (ValueError, TypeError, KeyError, AttributeError, OSError, UnicodeError):
        print(json.dumps({"error": "SBOM_PYTHON_INVENTORY_REJECTED"}))
        raise SystemExit(1) from None
