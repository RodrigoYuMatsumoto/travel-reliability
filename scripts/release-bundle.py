"""Assemble or verify nine public release assets without publishing or executing archives.

Only the explicitly supplied CI metadata and hash-bound B.9 receipt can establish
release eligibility. This program does not authenticate a model or run a review.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

REPOSITORY = "RodrigoYuMatsumoto/travel-reliability"
REQUIRED_CHECKS = {"verify", "SAST (Semgrep and Bandit)", "Fuzzing (bounded mutation)", "DAST (isolated HTTP and ZAP)"}
FAMILIES = {"openai", "anthropic", "google", "deepseek", "qwen", "maritaca", "xai"}
VERDICTS = {"APPROVE", "APPROVE_WITH_CAVEATS", "REJECT", "INCONCLUSIVE", "INDEPENDENCE_UNPROVEN", "NOT_RUN"}
APPROVALS = {"APPROVE", "APPROVE_WITH_CAVEATS"}
MAX_FILE = 20 * 1024 * 1024
MAX_JSON = 1024 * 1024


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hex_value(value, length):
    return isinstance(value, str) and re.fullmatch(r"[a-f0-9]{" + str(length) + "}", value) is not None


def version_value(value):
    return isinstance(value, str) and re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", value) is not None


def public_path(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_./-]+", value), "INVALID_PUBLIC_PATH")
    require(not value.startswith("/") and all(part not in {"", ".", ".."} for part in value.split("/")), "INVALID_PUBLIC_PATH")
    require(not any(part.lower() in {".git", ".local", ".venv", "node_modules", "private", "credentials"} or (part.lower().startswith(".env") and part != ".env.example") for part in value.split("/")), "FORBIDDEN_PUBLIC_PATH")
    for part in value.split("/"):
        require(not part.endswith(".") and not re.fullmatch(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", part.split(".", 1)[0], re.IGNORECASE), "NONPORTABLE_PUBLIC_PATH")
    return value


def read_regular(path, maximum=MAX_FILE):
    path = Path(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not path.is_symlink() and info.st_size <= maximum, "INVALID_INPUT_FILE")
    return path.read_bytes()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=True, sort_keys=True, indent=2) + "\n").encode("utf-8")


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    require(len(data) <= MAX_JSON, "JSON_SIZE_LIMIT")
    return json.loads(data.decode("utf-8-sig"), object_pairs_hook=pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("NONFINITE_JSON")))


def asset_names(version):
    require(version_value(version), "INVALID_RELEASE_VERSION")
    return {
        "source": f"travel-reliability-v{version}.zip",
        "agent-kit": f"travel-reliability-agent-kit-v{version}.zip",
        "skill": f"travel-reliability-skill-v{version}.zip",
        "agent-manifest": "agent-release-manifest.json",
        "agent-sums": "AGENT-SHA256SUMS",
        "sbom": "sbom.cdx.json",
        "audit": f"agent-audit-v{version}.json",
        "manifest": "release-manifest.json",
        "sums": "SHA256SUMS",
    }


def checksums(data, available, expected):
    require(len(data) <= 8192, "CHECKSUM_SIZE_LIMIT")
    records = {}
    for line in data.decode("ascii").splitlines():
        match = re.fullmatch(r"([a-f0-9]{64})  ([A-Za-z0-9._-]+)", line)
        require(match is not None, "INVALID_CHECKSUM_ENTRY")
        value, name = match.groups()
        require(name not in records and name in available and digest(available[name]) == value, "CHECKSUM_MISMATCH")
        records[name] = value
    require(set(records) == set(expected), "CHECKSUM_COVERAGE_MISMATCH")
    return records


def portable_archive_inventory(archive):
    canonical, files, directories, seen = {}, set(), set(), set()
    for entry in archive.infolist():
        require(entry.orig_filename == entry.filename, "ARCHIVE_PATH_NORMALIZATION_REJECTED")
        path = public_path(entry.filename.rstrip("/"))
        require(entry.filename not in seen, "DUPLICATE_ARCHIVE_PATH")
        seen.add(entry.filename)
        parts = path.split("/")
        for length in range(1, len(parts) + 1):
            component = "/".join(parts[:length])
            folded = component.casefold()
            require(folded not in canonical or canonical[folded] == component, "ARCHIVE_CASE_ALIAS_REJECTED")
            canonical[folded] = component
            if length < len(parts):
                require(folded not in files, "ARCHIVE_FILE_DIRECTORY_COLLISION")
                directories.add(folded)
        folded = path.casefold()
        if entry.is_dir():
            require(folded not in files, "ARCHIVE_FILE_DIRECTORY_COLLISION")
            directories.add(folded)
        else:
            require(folded not in directories, "ARCHIVE_FILE_DIRECTORY_COLLISION")
            files.add(folded)


def source_files(data, version):
    import io
    require(len(data) <= MAX_FILE, "ARCHIVE_SIZE_LIMIT")
    result = {}
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        portable_archive_inventory(archive)
        entries = archive.infolist()
        require(0 < len(entries) <= 2000 and sum(item.file_size for item in entries) <= 100 * 1024 * 1024, "ARCHIVE_SIZE_LIMIT")
        prefix = f"travel-reliability-v{version}/"
        seen = set()
        for item in entries:
            require(item.filename not in seen and item.filename.startswith(prefix), "ARCHIVE_INVENTORY_MISMATCH")
            seen.add(item.filename)
            relative = item.filename[len(prefix):]
            if not relative and item.is_dir():
                continue
            public_path(relative.rstrip("/"))
            require(item.file_size <= MAX_FILE and not item.flag_bits & 1 and not stat.S_ISLNK(item.external_attr >> 16), "ARCHIVE_ENTRY_REJECTED")
            if not item.is_dir():
                result[relative] = archive.read(item)
        require(archive.testzip() is None, "ARCHIVE_CRC_MISMATCH")
    package = strict_json(result["package.json"])
    require(package.get("name") == "travel-reliability" and package.get("version") == version, "SOURCE_PACKAGE_MISMATCH")
    return result


def validate_workflows(value, commit):
    require(isinstance(value, list) and len(value) <= 8, "INVALID_WORKFLOW_EVIDENCE")
    result, successful = [], set()
    identities, workflow_paths = set(), set()
    for row in value:
        require(isinstance(row, dict), "INVALID_WORKFLOW_EVIDENCE")
        run_id, attempt = row.get("id"), row.get("attempt", 1)
        require(type(run_id) is int and run_id > 0 and type(attempt) is int and 1 <= attempt <= 100, "INVALID_WORKFLOW_ID")
        require((run_id, attempt) not in identities, "DUPLICATE_WORKFLOW_EVIDENCE")
        identities.add((run_id, attempt))
        require(row.get("sourceCommit") == commit, "WORKFLOW_COMMIT_MISMATCH")
        require(row.get("event") in {"push", "pull_request", "workflow_dispatch"}, "INVALID_WORKFLOW_EVENT")
        require(row.get("status") in {"completed", "in_progress", "queued"}, "INVALID_WORKFLOW_STATUS")
        require(row.get("conclusion") in {"success", "failure", "cancelled", "timed_out", "skipped", None}, "INVALID_WORKFLOW_CONCLUSION")
        path = row.get("workflow")
        require(path in {".github/workflows/ci.yml", ".github/workflows/security-audit.yml"}, "UNEXPECTED_WORKFLOW")
        require(path not in workflow_paths, "DUPLICATE_WORKFLOW_PATH")
        workflow_paths.add(path)
        require(row.get("headBranch") in {None, "main", "other"}, "INVALID_WORKFLOW_BRANCH")
        jobs = row.get("jobs")
        require(isinstance(jobs, list) and len(jobs) <= 16, "INVALID_JOB_EVIDENCE")
        names = set()
        safe_jobs = []
        for job in jobs:
            require(isinstance(job, dict) and job.get("name") in REQUIRED_CHECKS and job["name"] not in names, "INVALID_JOB_EVIDENCE")
            names.add(job["name"])
            require(job.get("conclusion") in {"success", "failure", "cancelled", "timed_out", "skipped", None}, "INVALID_JOB_CONCLUSION")
            safe_jobs.append({"name": job["name"], "conclusion": job["conclusion"]})
        if row["status"] == "completed" and row["conclusion"] == "success" and row["event"] == "push" and row.get("headBranch") == "main":
            expected_jobs = {"verify"} if path.endswith("/ci.yml") else REQUIRED_CHECKS - {"verify"}
            require(names == expected_jobs, "WORKFLOW_JOB_COVERAGE_MISMATCH")
            successful.update(job["name"] for job in safe_jobs if job["conclusion"] == "success")
        result.append({"id": run_id, "attempt": attempt, "sourceCommit": commit, "headBranch": row.get("headBranch"), "event": row["event"], "status": row["status"], "conclusion": row["conclusion"], "workflow": path, "jobs": safe_jobs, "url": f"https://github.com/{REPOSITORY}/actions/runs/{run_id}"})
    return result, successful == REQUIRED_CHECKS


def evidence_object(value, directory):
    require(isinstance(value, dict) and set(value) == {"object", "sha256"}, "INVALID_REVIEW_OBJECT")
    name = value["object"]
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}\.(?:json|txt|md)", name), "INVALID_REVIEW_OBJECT")
    require(hex_value(value["sha256"], 64), "INVALID_REVIEW_DIGEST")
    base = Path(directory).resolve(strict=True)
    path = base / name
    require(path.resolve(strict=True).parent == base, "REVIEW_OBJECT_ESCAPE")
    require(digest(read_regular(path, 4 * 1024 * 1024)) == value["sha256"], "REVIEW_OBJECT_DIGEST_MISMATCH")
    return value["sha256"]


def validate_review(receipt, evidence_directory, files, version, commit, tree, changed_paths=None, deleted_paths=None):
    if receipt is None:
        return {"overall": "NOT_RUN", "evidence": "No review receipt supplied."}, False
    require(receipt.get("format") == "travel-reliability-b9-receipt/1", "INVALID_REVIEW_RECEIPT")
    require(receipt.get("version") == version and receipt.get("sourceCommit") == commit and receipt.get("sourceTree") == tree, "REVIEW_SNAPSHOT_MISMATCH")
    require(hex_value(receipt.get("baselineCommit"), 40), "INVALID_REVIEW_BASELINE")
    generators = receipt.get("generatorFamilies")
    require(isinstance(generators, list) and generators and len(generators) == len(set(generators)) and set(generators) <= FAMILIES, "INVALID_GENERATOR_FAMILIES")
    overall = receipt.get("result")
    require(overall in VERDICTS, "INVALID_REVIEW_VERDICT")
    inventory = receipt.get("files")
    require(isinstance(inventory, list) and 0 < len(inventory) <= 2000, "INVALID_REVIEW_INVENTORY")
    covered = set()
    for item in inventory:
        require(isinstance(item, dict) and set(item) == {"path", "sha256"}, "INVALID_REVIEW_INVENTORY")
        path = public_path(item["path"])
        require(path not in covered and path in files and hex_value(item["sha256"], 64), "INVALID_REVIEW_INVENTORY")
        require(digest(files[path]) == item["sha256"], "REVIEW_FILE_DIGEST_MISMATCH")
        covered.add(path)
    deleted = receipt.get("deletedPaths", [])
    require(isinstance(deleted, list) and len(deleted) == len(set(deleted)) and all(public_path(path) not in files for path in deleted), "INVALID_REVIEW_DELETIONS")
    if changed_paths is not None:
        require(set(changed_paths) <= covered, "REVIEW_DELTA_COVERAGE_MISSING")
    if deleted_paths is not None:
        require(set(deleted_paths) == set(deleted), "REVIEW_DELETION_COVERAGE_MISMATCH")
    packets = receipt.get("packets")
    require(isinstance(packets, list) and 0 < len(packets) <= 25 and evidence_directory is not None, "INVALID_REVIEW_PACKETS")
    packet_ids, packet_coverage, results, known_responses = set(), set(), [], set()
    all_approved = True
    saw_caveat = False
    for packet in packets:
        packet_id = packet.get("id")
        require(isinstance(packet_id, str) and re.fullmatch(r"[A-Z0-9_-]{1,24}", packet_id) and packet_id not in packet_ids, "INVALID_REVIEW_PACKET_ID")
        packet_ids.add(packet_id)
        paths = packet.get("files")
        require(isinstance(paths, list) and paths and len(paths) == len(set(paths)) and set(paths) <= covered, "INVALID_REVIEW_PACKET_COVERAGE")
        packet_coverage.update(paths)
        criteria_hash = evidence_object(packet.get("criteria"), evidence_directory)
        responses = packet.get("responses")
        require(isinstance(responses, list) and 0 < len(responses) <= 12, "INVALID_REVIEW_RESPONSES")
        families, safe_responses = set(), []
        for response in responses:
            family, result = response.get("family"), response.get("result")
            require(family in FAMILIES and family not in generators and family not in families, "REVIEW_FAMILY_NOT_DISTINCT")
            require(result in VERDICTS, "INVALID_REVIEW_VERDICT")
            response_hash = evidence_object({"object": response.get("object"), "sha256": response.get("sha256")}, evidence_directory)
            require(response_hash not in known_responses, "REUSED_REVIEW_RESPONSE")
            known_responses.add(response_hash)
            eligibility_hash = evidence_object(response.get("eligibility"), evidence_directory)
            families.add(family)
            all_approved = all_approved and result in APPROVALS
            saw_caveat = saw_caveat or result == "APPROVE_WITH_CAVEATS"
            safe_responses.append({"family": family, "result": result, "sha256": response_hash, "eligibilitySha256": eligibility_hash})
        all_approved = all_approved and len(families) >= 2
        results.append({"id": packet_id, "fileCount": len(paths), "criteriaSha256": criteria_hash, "responses": safe_responses})
    require(packet_coverage == covered, "REVIEW_PACKET_COVERAGE_MISSING")
    if overall in APPROVALS:
        require(all_approved and (not saw_caveat or overall == "APPROVE_WITH_CAVEATS"), "REVIEW_VERDICT_CONTRADICTION")
    return {"overall": overall, "generatorFamilies": generators, "baselineCommit": receipt["baselineCommit"], "sourceCommit": commit, "sourceTree": tree, "reviewedFileCount": len(covered), "deletedFileCount": len(deleted), "files": inventory, "deletedPaths": deleted, "packets": results, "exactModelVersions": "Not inferred by the bundler.", "limits": "Hashes bind the supplied review objects; this program does not authenticate model identity or independently adjudicate their content."}, overall in APPROVALS and all_approved


def public_review_approved(review, commit, tree):
    require(isinstance(review, dict) and review.get("overall") in VERDICTS, "INVALID_PUBLIC_REVIEW")
    if review["overall"] not in APPROVALS:
        return False
    generators = review.get("generatorFamilies")
    require(isinstance(generators, list) and generators and set(generators) <= FAMILIES, "INVALID_PUBLIC_REVIEW")
    require(review.get("sourceCommit") == commit and review.get("sourceTree") == tree and hex_value(review.get("baselineCommit"), 40), "PUBLIC_REVIEW_SNAPSHOT_MISMATCH")
    require(type(review.get("reviewedFileCount")) is int and review["reviewedFileCount"] > 0, "INVALID_PUBLIC_REVIEW")
    packets = review.get("packets")
    require(isinstance(packets, list) and 0 < len(packets) <= 25, "INVALID_PUBLIC_REVIEW")
    all_response_hashes, packet_ids, saw_caveat = set(), set(), False
    for packet in packets:
        require(isinstance(packet, dict) and isinstance(packet.get("id"), str) and re.fullmatch(r"[A-Z0-9_-]{1,24}", packet["id"]) and packet["id"] not in packet_ids, "INVALID_PUBLIC_REVIEW")
        packet_ids.add(packet["id"])
        require(type(packet.get("fileCount")) is int and 0 < packet["fileCount"] <= review["reviewedFileCount"] and hex_value(packet.get("criteriaSha256"), 64), "INVALID_PUBLIC_REVIEW")
        responses = packet.get("responses")
        require(isinstance(responses, list) and 2 <= len(responses) <= 12, "PUBLIC_REVIEW_QUORUM_MISSING")
        families = set()
        for response in responses:
            family = response.get("family")
            require(family in FAMILIES and family not in generators and family not in families, "REVIEW_FAMILY_NOT_DISTINCT")
            families.add(family)
            require(response.get("result") in APPROVALS and hex_value(response.get("sha256"), 64) and hex_value(response.get("eligibilitySha256"), 64), "INVALID_PUBLIC_REVIEW")
            require(response["sha256"] not in all_response_hashes, "REUSED_REVIEW_RESPONSE")
            all_response_hashes.add(response["sha256"])
            saw_caveat = saw_caveat or response["result"] == "APPROVE_WITH_CAVEATS"
    require(not saw_caveat or review["overall"] == "APPROVE_WITH_CAVEATS", "REVIEW_VERDICT_CONTRADICTION")
    return True


def validate_base_assets(assets, version, commit):
    names = asset_names(version)
    required = {names[key] for key in ["source", "agent-kit", "skill", "agent-manifest", "agent-sums", "sbom"]}
    require(set(assets) == required, "BASE_ASSET_INVENTORY_MISMATCH")
    files = source_files(assets[names["source"]], version)
    catalog = strict_json(files["agents/manifest.json"])
    counts = {"agents": len(catalog["agents"]), "workflows": len(catalog["commands"]), "calculators": len({item["calculatorId"] for item in catalog["commands"] if item.get("calculatorId")})}
    spec = importlib.util.spec_from_file_location("release_agent_verifier", Path(__file__).with_name("verify-agent-package.py"))
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    import io
    validations = []
    for kind in ["agent-kit", "skill"]:
        with zipfile.ZipFile(io.BytesIO(assets[names[kind]])) as archive:
            portable_archive_inventory(archive)
            result = verifier.validate_archive(archive, commit, version)
            require(result["counts"] == counts, "AGENT_COUNT_MISMATCH")
            manifest_path = next(name for name in archive.namelist() if name.endswith("/PACKAGE-MANIFEST.json"))
            inventory = strict_json(archive.read(manifest_path))
            for item in inventory["files"]:
                if "sourcePath" in item:
                    require(item["sourcePath"] in files and digest(files[item["sourcePath"]]) == item["sourceSha256"], "AGENT_SOURCE_BINDING_MISMATCH")
            validations.append({"artifact": names[kind], **result})
    manifest = strict_json(assets[names["agent-manifest"]])
    require(set(manifest) == {"version", "commit", "counts", "artifacts"}, "AGENT_MANIFEST_FIELDS_REJECTED")
    require(manifest.get("version") == version and manifest.get("commit") == commit and manifest.get("counts") == counts, "AGENT_MANIFEST_MISMATCH")
    records = manifest.get("artifacts")
    require(isinstance(records, list) and len(records) == 2, "AGENT_MANIFEST_MISMATCH")
    require({row.get("kind") for row in records} == {"agent-kit", "skill"}, "AGENT_MANIFEST_MISMATCH")
    for row in records:
        require(set(row) == {"kind", "name", "sha256", "files"}, "AGENT_MANIFEST_FIELDS_REJECTED")
        name = names[row["kind"]]
        validation = next(item for item in validations if item["artifact"] == name)
        require(row.get("name") == name and row.get("sha256") == digest(assets[name]) and row.get("files") == validation["files"], "AGENT_MANIFEST_MISMATCH")
    checksums(assets[names["agent-sums"]], assets, {names["agent-kit"], names["skill"]})
    sbom = strict_json(assets[names["sbom"]])
    component = sbom.get("metadata", {}).get("component", {})
    require(sbom.get("bomFormat") == "CycloneDX" and component.get("name") == "travel-reliability" and component.get("version") == version, "SBOM_IDENTITY_MISMATCH")
    require(isinstance(sbom.get("components"), list), "INVALID_SBOM_COMPONENTS")
    return files, counts, validations, len(sbom["components"])


def build_bundle(base_assets, evidence, receipt=None, review_directory=None, changed_paths=None, deleted_paths=None, require_stable=False):
    require(evidence.get("format") == "travel-reliability-release-evidence/1", "INVALID_RELEASE_EVIDENCE")
    version, commit, tree = evidence.get("version"), evidence.get("sourceCommit"), evidence.get("sourceTree")
    require(version_value(version) and hex_value(commit, 40) and hex_value(tree, 40), "INVALID_RELEASE_SNAPSHOT")
    generated = evidence.get("generatedAt")
    require(isinstance(generated, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z", generated), "INVALID_EVIDENCE_TIME")
    from datetime import datetime
    try:
        datetime.fromisoformat(generated.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("INVALID_EVIDENCE_TIME") from error
    files, counts, archive_validation, components = validate_base_assets(base_assets, version, commit)
    workflows, ci_ok = validate_workflows(evidence.get("workflows", []), commit)
    review, review_ok = validate_review(receipt, review_directory, files, version, commit, tree, changed_paths, deleted_paths)
    names = asset_names(version)
    eligible = ci_ok and review_ok and changed_paths is not None and deleted_paths is not None and "-" not in version
    require(not require_stable or eligible, "STABLE_RELEASE_GATE_NOT_SATISFIED")
    report = {"format": "travel-reliability-agent-release-validation/3", "version": version, "sourceCommit": commit, "sourceTree": tree, "generatedAt": generated, "workflows": workflows, "catalog": counts, "review": review, "verification": {"archiveVerification": archive_validation, "sbomComponents": components, "evidenceSha256": digest(json_bytes(evidence)), "reviewReceiptSha256": digest(json_bytes(receipt)) if receipt is not None else None}, "releaseEligibility": {"eligible": eligible, "ciRequiredChecksPassed": ci_ok, "reviewGatePassed": review_ok}, "limits": ["CI and review evidence are supplied declarations validated for identity, coverage and hashes, not a signed external attestation.", "No private review objects or local paths are copied into this bundle.", "Archive validation does not prove universal security, legal accuracy or host-LLM behavior."]}
    report["verification"]["publicEvidenceProjectionSha256"] = digest(json_bytes({key: report[key] for key in ["version", "sourceCommit", "sourceTree", "generatedAt", "workflows"]}))
    assets = dict(base_assets)
    assets[names["audit"]] = json_bytes(report)
    manifest = {"format": "travel-reliability-release-manifest/2", "version": version, "commit": commit, "sourceTree": tree, "includes": "committed source and declared public release metadata only", "excludes": "runtime data, credentials, private review objects, dependency directories and Git internals", "assets": [{"name": name, "sha256": digest(data)} for name, data in sorted(assets.items())], "verificationWorkflows": [row["url"] for row in workflows]}
    assets[names["manifest"]] = json_bytes(manifest)
    assets[names["sums"]] = "".join(f"{digest(data)}  {name}\n" for name, data in sorted(assets.items())).encode("ascii")
    require(set(assets) == set(names.values()), "RELEASE_ASSET_INVENTORY_MISMATCH")
    return assets, report


def verify_bundle(directory, expected_commit=None, expected_version=None, require_stable=False, github_metadata=None, source_tree_repository=None, github_ci_reader=None):
    directory = Path(directory)
    manifest = strict_json(read_regular(directory / "release-manifest.json", MAX_JSON))
    version, commit = manifest.get("version"), manifest.get("commit")
    names = asset_names(version)
    require(hex_value(commit, 40) and manifest.get("format") == "travel-reliability-release-manifest/2", "INVALID_RELEASE_MANIFEST")
    require(expected_commit is None or expected_commit == commit, "SOURCE_COMMIT_MISMATCH")
    require(expected_version is None or expected_version == version, "PACKAGE_VERSION_MISMATCH")
    require({entry.name for entry in directory.iterdir()} == set(names.values()), "RELEASE_ASSET_INVENTORY_MISMATCH")
    assets = {name: read_regular(directory / name) for name in names.values()}
    checksums(assets[names["sums"]], assets, set(assets) - {names["sums"]})
    manifest_assets = manifest.get("assets")
    require(isinstance(manifest_assets, list) and len(manifest_assets) == 7, "MANIFEST_ASSET_INVENTORY_MISMATCH")
    indexed = {}
    for row in manifest_assets:
        name = row.get("name")
        require(name in assets and name not in indexed and row.get("sha256") == digest(assets[name]), "MANIFEST_ASSET_DIGEST_MISMATCH")
        indexed[name] = row["sha256"]
    require(set(indexed) == set(assets) - {names["manifest"], names["sums"]}, "MANIFEST_ASSET_INVENTORY_MISMATCH")
    base = {names[key]: assets[names[key]] for key in ["source", "agent-kit", "skill", "agent-manifest", "agent-sums", "sbom"]}
    files, counts, validations, components = validate_base_assets(base, version, commit)
    require(not require_stable or source_tree_repository is not None, "TRUSTED_SOURCE_CHECKOUT_REQUIRED")
    if source_tree_repository is not None:
        require(expected_commit is not None, "EXPECTED_COMMIT_REQUIRED_FOR_SOURCE_BINDING")
        repository = Path(source_tree_repository).resolve(strict=True)
        require(Path(safe_git(repository, ["rev-parse", "--show-toplevel"])).resolve() == repository, "CORE_GIT_STANDALONE_REQUIRED")
        require(safe_git(repository, ["rev-parse", f"{commit}^{{tree}}"] ) == manifest.get("sourceTree"), "SOURCE_TREE_IDENTITY_MISMATCH")
        validate_git_source_tree(files, git_source_snapshot(repository, commit))
    report = strict_json(assets[names["audit"]])
    require(report.get("format") == "travel-reliability-agent-release-validation/3" and report.get("version") == version and report.get("sourceCommit") == commit and report.get("sourceTree") == manifest.get("sourceTree"), "AUDIT_REPORT_SNAPSHOT_MISMATCH")
    _, ci_ok = validate_workflows(report.get("workflows"), commit)
    require(report.get("catalog") == counts, "AUDIT_CATALOG_COUNTS_MISMATCH")
    projected = {key: report.get(key) for key in ["version", "sourceCommit", "sourceTree", "generatedAt", "workflows"]}
    require(report.get("verification", {}).get("publicEvidenceProjectionSha256") == digest(json_bytes(projected)), "PUBLIC_EVIDENCE_PROJECTION_MISMATCH")
    gate = report.get("releaseEligibility", {})
    review_ok = public_review_approved(report.get("review"), commit, manifest.get("sourceTree"))
    if review_ok:
        inventory = report["review"].get("files")
        require(isinstance(inventory, list) and len(inventory) == report["review"]["reviewedFileCount"], "PUBLIC_REVIEW_INVENTORY_REQUIRED")
        reviewed = set()
        for item in inventory:
            name = public_path(item["path"])
            require(name in files and name not in reviewed and item.get("sha256") == digest(files[name]), "PUBLIC_REVIEW_FILE_BINDING_MISMATCH")
            reviewed.add(name)
        deleted = report["review"].get("deletedPaths")
        require(isinstance(deleted, list) and len(set(deleted)) == len(deleted) and len(deleted) == report["review"]["deletedFileCount"] and all(public_path(name) not in files for name in deleted), "PUBLIC_REVIEW_DELETIONS_MISMATCH")
        if source_tree_repository is not None:
            baseline = report["review"]["baselineCommit"]
            safe_git(repository, ["merge-base", "--is-ancestor", baseline, commit])
            changed = set(safe_git(repository, ["diff", "--name-only", "--diff-filter=ACMRT", baseline, commit]).splitlines())
            removed = set(safe_git(repository, ["diff", "--name-only", "--diff-filter=D", baseline, commit]).splitlines())
            require(changed <= reviewed and removed == set(deleted), "PUBLIC_REVIEW_DELTA_COVERAGE_MISMATCH")
    actions_ok = False
    if github_ci_reader is not None:
        verify_actions(report["workflows"], commit, github_ci_reader)
        actions_ok = True
    require(not require_stable or actions_ok, "TRUSTED_ACTIONS_READ_REQUIRED")
    require(not gate.get("eligible") or (ci_ok and review_ok and gate.get("ciRequiredChecksPassed") is True and gate.get("reviewGatePassed") is True), "AUDIT_REPORT_GATE_CONTRADICTION")
    require(not require_stable or gate.get("eligible") is True, "STABLE_RELEASE_GATE_NOT_SATISFIED")
    if github_metadata is not None:
        require(github_metadata.get("tag_name") == "v" + version and github_metadata.get("draft") is False and github_metadata.get("prerelease") is False, "GITHUB_RELEASE_METADATA_MISMATCH")
        rows = github_metadata.get("assets")
        require(isinstance(rows, list) and len(rows) == 9, "GITHUB_ASSET_INVENTORY_MISMATCH")
        require({row.get("name") for row in rows} == set(assets), "GITHUB_ASSET_INVENTORY_MISMATCH")
        for row in rows:
            require(row.get("digest") == "sha256:" + digest(assets[row["name"]]), "GITHUB_ASSET_DIGEST_MISMATCH")
    return {"status": "PASS", "version": version, "sourceCommit": commit, "assets": 9, "agentArchives": validations, "sbomComponents": components, "sourceTreeBinding": "PASS" if source_tree_repository is not None else "NOT_RUN", "actionsBinding": "PASS" if actions_ok else "NOT_RUN", "recordedEligible": gate.get("eligible") is True, "stableEligible": gate.get("eligible") is True and source_tree_repository is not None and actions_ok, "limits": "Source bytes and optional live Actions metadata are bound; model identity and private review content are not independently authenticated."}


def safe_git(root, args, binary=False, input_data=None):
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith("GIT_")}
    environment.update({"GIT_TERMINAL_PROMPT": "0", "GIT_NO_REPLACE_OBJECTS": "1", "GIT_OPTIONAL_LOCKS": "0"})
    try:
        output = subprocess.run(["git", "--no-pager", "-c", "core.fsmonitor=false", *args], cwd=root, env=environment, input=input_data, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30).stdout
        return output if binary else output.decode("utf-8").strip()
    except (OSError, subprocess.SubprocessError, UnicodeError) as error:
        raise ValueError("RELEASE_GIT_COMMAND_FAILED") from error


def read_github_json(endpoint):
    require(re.fullmatch(r"repos/" + re.escape(REPOSITORY) + r"/actions/runs(?:/[1-9]\d*(?:/attempts/[1-9]\d*/jobs\?per_page=100)?|\?head_sha=[a-f0-9]{40}&branch=main&event=push&per_page=100)", endpoint), "INVALID_GITHUB_ENDPOINT")
    try:
        completed = subprocess.run(["gh", "api", endpoint], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
        return strict_json(completed.stdout)
    except (OSError, subprocess.SubprocessError) as error:
        raise ValueError("GITHUB_EVIDENCE_READ_FAILED") from error


def verify_actions(workflows, commit, reader):
    rows, passed = validate_workflows(workflows, commit)
    require(passed and len(rows) == 2, "ACTIONS_RECORDED_CHECKS_NOT_PASSED")
    prefix = f"repos/{REPOSITORY}/actions/runs"
    recent = reader(f"{prefix}?head_sha={commit}&branch=main&event=push&per_page=100")
    runs = recent.get("workflow_runs")
    require(isinstance(runs, list) and recent.get("total_count") == len(runs) and len(runs) <= 100, "ACTIONS_RUN_PAGINATION_INCOMPLETE")
    for row in rows:
        matching = [run for run in runs if run.get("path") == row["workflow"] and run.get("head_sha") == commit and run.get("head_branch") == "main" and run.get("event") == "push"]
        require(matching and max(matching, key=lambda run: (run.get("created_at", ""), run.get("id", 0))).get("id") == row["id"], "ACTIONS_NEWER_RUN_EXISTS")
        run = reader(f"{prefix}/{row['id']}")
        require(run.get("id") == row["id"] and run.get("head_sha") == commit and run.get("head_branch") == "main" and run.get("event") == "push" and run.get("path") == row["workflow"] and run.get("run_attempt") == row["attempt"] and run.get("status") == "completed" and run.get("conclusion") == "success", "ACTIONS_RUN_BINDING_MISMATCH")
        jobs = reader(f"{prefix}/{row['id']}/attempts/{row['attempt']}/jobs?per_page=100")
        actual = jobs.get("jobs")
        require(isinstance(actual, list) and jobs.get("total_count") == len(actual) and all(job.get("status") == "completed" for job in actual), "ACTIONS_JOB_COVERAGE_INCOMPLETE")
        expected_jobs = sorted((job["name"], job["conclusion"]) for job in row["jobs"])
        require(sorted((job.get("name"), job.get("conclusion")) for job in actual) == expected_jobs, "ACTIONS_JOB_BINDING_MISMATCH")
    return True


def collect_ci(args):
    from datetime import datetime, timezone
    root = Path(__file__).resolve().parent.parent
    require(Path(safe_git(root, ["rev-parse", "--show-toplevel"])).resolve() == root, "CORE_GIT_STANDALONE_REQUIRED")
    require(not safe_git(root, ["status", "--porcelain"]), "RELEASE_REQUIRES_CLEAN_COMMITTED_TREE")
    commit = safe_git(root, ["rev-parse", "HEAD"])
    tree = safe_git(root, ["rev-parse", "HEAD^{tree}"])
    version = strict_json(read_regular(root / "package.json", MAX_JSON))["version"]
    workflows = []
    for run_id, path in [(args.verify_run, ".github/workflows/ci.yml"), (args.security_run, ".github/workflows/security-audit.yml")]:
        require(type(run_id) is int and run_id > 0, "INVALID_WORKFLOW_ID")
        row = read_github_json(f"repos/{REPOSITORY}/actions/runs/{run_id}")
        require(row.get("id") == run_id and row.get("head_sha") == commit and row.get("head_branch") == "main" and row.get("path") == path, "GITHUB_RUN_IDENTITY_MISMATCH")
        attempt = row.get("run_attempt")
        require(type(attempt) is int and 1 <= attempt <= 100, "INVALID_WORKFLOW_ATTEMPT")
        jobs = read_github_json(f"repos/{REPOSITORY}/actions/runs/{run_id}/attempts/{attempt}/jobs?per_page=100")
        require(isinstance(jobs.get("jobs"), list) and jobs.get("total_count") == len(jobs["jobs"]), "GITHUB_JOB_COVERAGE_INCOMPLETE")
        workflows.append({"id": run_id, "attempt": attempt, "sourceCommit": commit, "headBranch": "main", "event": row.get("event"), "status": row.get("status"), "conclusion": row.get("conclusion"), "workflow": path, "jobs": [{"name": job.get("name"), "conclusion": job.get("conclusion")} for job in jobs["jobs"]]})
    validate_workflows(workflows, commit)
    evidence = {"format": "travel-reliability-release-evidence/1", "version": version, "sourceCommit": commit, "sourceTree": tree, "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), "workflows": workflows}
    verify_actions(workflows, commit, read_github_json)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as handle:
        handle.write(json_bytes(evidence))
    return {"status": "PASS", "sourceCommit": commit, "workflows": len(workflows), "publication": "Not performed; only the explicit public Actions runs were read."}


def git_source_snapshot(root, commit):
    require(hex_value(commit, 40), "INVALID_SOURCE_COMMIT")
    entries = safe_git(root, ["ls-tree", "-rz", "--full-tree", commit], binary=True).split(b"\0")
    members = []
    for entry in filter(None, entries):
        header, path_bytes = entry.split(b"\t", 1)
        mode, kind, oid = header.decode("ascii").split(" ")
        require(kind == "blob" and mode in {"100644", "100755"} and hex_value(oid, 40), "SOURCE_TREE_REGULAR_FILES_REQUIRED")
        members.append((public_path(path_bytes.decode("utf-8")), oid))
    require(len(members) <= 2000, "SOURCE_TREE_SIZE_LIMIT")
    data = safe_git(root, ["cat-file", "--batch"], binary=True, input_data="".join(oid + "\n" for _, oid in members).encode("ascii"))
    require(len(data) <= 100 * 1024 * 1024 + 200000, "SOURCE_TREE_SIZE_LIMIT")
    expected, total = {}, 0
    offset = 0
    for path, oid in members:
        newline = data.find(b"\n", offset)
        require(newline >= 0, "SOURCE_TREE_FILE_MISSING")
        fields = data[offset:newline].decode("ascii").split(" ")
        require(len(fields) == 3 and fields[:2] == [oid, "blob"] and fields[2].isdigit(), "SOURCE_TREE_FILE_MISSING")
        size = int(fields[2])
        total += size
        require(size <= MAX_FILE and total <= 100 * 1024 * 1024 and path not in expected, "SOURCE_TREE_SIZE_LIMIT")
        offset = newline + 1
        require(offset + size < len(data) and data[offset + size:offset + size + 1] == b"\n", "SOURCE_TREE_FILE_MISSING")
        expected[path] = data[offset:offset + size]
        offset += size + 1
    require(offset == len(data), "SOURCE_TREE_TRAILING_DATA")
    return expected


def validate_git_source_tree(files, expected):
    require(set(files) == set(expected), "SOURCE_TREE_INVENTORY_MISMATCH")
    for path, content in files.items():
        require(digest(content) == digest(expected[path]), "SOURCE_TREE_BLOB_MISMATCH")


def assemble(args):
    root = Path(__file__).resolve().parent.parent
    require(Path(safe_git(root, ["rev-parse", "--show-toplevel"])).resolve() == root, "CORE_GIT_STANDALONE_REQUIRED")
    require(not safe_git(root, ["status", "--porcelain"]), "RELEASE_REQUIRES_CLEAN_COMMITTED_TREE")
    evidence = strict_json(read_regular(args.evidence, MAX_JSON))
    version = strict_json(read_regular(root / "package.json", MAX_JSON))["version"]
    commit = safe_git(root, ["rev-parse", "HEAD"])
    tree = safe_git(root, ["rev-parse", "HEAD^{tree}"])
    require(evidence.get("version") == version and evidence.get("sourceCommit") == commit and evidence.get("sourceTree") == tree, "EVIDENCE_HEAD_MISMATCH")
    receipt = strict_json(read_regular(args.review_receipt, MAX_JSON)) if args.review_receipt else None
    changed, deleted = None, None
    if receipt is not None:
        baseline = receipt.get("baselineCommit")
        require(hex_value(baseline, 40), "INVALID_REVIEW_BASELINE")
        safe_git(root, ["merge-base", "--is-ancestor", baseline, commit])
        changed = safe_git(root, ["diff", "--name-only", "--diff-filter=ACMRT", baseline, commit]).splitlines()
        deleted = safe_git(root, ["diff", "--name-only", "--diff-filter=D", baseline, commit]).splitlines()
    names = asset_names(version)
    source = Path(args.artifacts).resolve()
    base = {names[key]: read_regular(source / names[key]) for key in ["source", "agent-kit", "skill", "agent-manifest", "agent-sums"]}
    base[names["sbom"]] = read_regular(args.sbom)
    validate_git_source_tree(source_files(base[names["source"]], version), git_source_snapshot(root, commit))
    source_manifest = strict_json(read_regular(source / "release-manifest.json", MAX_JSON))
    require(source_manifest.get("version") == version and source_manifest.get("commit") == commit and source_manifest.get("sha256") == digest(base[names["source"]]), "SOURCE_MANIFEST_MISMATCH")
    assets, report = build_bundle(base, evidence, receipt, args.review_evidence_dir, changed, deleted, args.require_stable)
    output = Path(args.output)
    require(not output.exists(), "RELEASE_OUTPUT_ALREADY_EXISTS")
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".release-stage-", dir=output.parent))
    try:
        for name, data in assets.items():
            with (temporary / name).open("xb") as handle:
                handle.write(data)
        verify_bundle(temporary, commit, version, args.require_stable, source_tree_repository=root, github_ci_reader=read_github_json if args.check_github_actions else None)
        require(not output.exists(), "RELEASE_OUTPUT_ALREADY_EXISTS")
        temporary.rename(output)
    finally:
        if temporary.exists():
            require(not temporary.is_symlink() and temporary.resolve().parent == output.parent.resolve() and temporary.name.startswith(".release-stage-"), "RELEASE_STAGE_CLEANUP_BOUNDARY")
            shutil.rmtree(temporary)
    return {"status": "PASS", "version": version, "sourceCommit": commit, "assets": len(assets), "stableEligible": report["releaseEligibility"]["eligible"], "publication": "Not performed; this command has no network or publishing operation."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    build = commands.add_parser("assemble")
    build.add_argument("--artifacts", type=Path, default=Path(__file__).resolve().parent.parent / "artifacts")
    build.add_argument("--sbom", type=Path, default=Path(__file__).resolve().parent.parent / "sbom.cdx.json")
    build.add_argument("--evidence", type=Path, required=True)
    build.add_argument("--review-receipt", type=Path)
    build.add_argument("--review-evidence-dir", type=Path)
    build.add_argument("--output", type=Path, required=True)
    build.add_argument("--require-stable", action="store_true")
    build.add_argument("--check-github-actions", action="store_true")
    verify = commands.add_parser("verify")
    verify.add_argument("--directory", type=Path, required=True)
    verify.add_argument("--expected-commit")
    verify.add_argument("--expected-version")
    verify.add_argument("--require-stable", action="store_true")
    verify.add_argument("--check-github-actions", action="store_true")
    verify.add_argument("--github-release-metadata", type=Path)
    verify.add_argument("--source-tree-repository", type=Path)
    collect = commands.add_parser("collect-ci")
    collect.add_argument("--verify-run", type=int, required=True)
    collect.add_argument("--security-run", type=int, required=True)
    collect.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "assemble":
            result = assemble(args)
        elif args.command == "collect-ci":
            result = collect_ci(args)
        else:
            metadata = strict_json(read_regular(args.github_release_metadata, MAX_JSON)) if args.github_release_metadata else None
            result = verify_bundle(args.directory, args.expected_commit, args.expected_version, args.require_stable, metadata, args.source_tree_repository, read_github_json if args.check_github_actions else None)
    except (OSError, ValueError, TypeError, KeyError, AttributeError, UnicodeError, zipfile.BadZipFile, RuntimeError) as error:
        code = str(error) if re.fullmatch(r"[A-Z0-9_]{1,80}", str(error)) else "RELEASE_BUNDLE_REJECTED"
        print(json.dumps({"status": "FAIL", "error": code, "privacy": "Input content, paths and raw exceptions are not reflected."}))
        return 1
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
