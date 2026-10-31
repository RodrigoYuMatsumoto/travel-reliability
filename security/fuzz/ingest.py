"""Seeded mutation campaign for passive document extraction; no network or real documents.

Run with the locked ingest interpreter. Each batch is a disposable subprocess,
with a wall deadline and POSIX address-space/CPU limits where supported. On
Windows the report explicitly states that no OS memory limit was applied.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import io
import json
import platform
import random
import re
import subprocess
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KINDS = ("plain", "utf8", "html", "docx", "pdf", "eml", "eml_attachment", "eml_text_limit")


def mime_message(depth: int, parts: int = 1) -> bytes:
    data = b"Content-Type: text/plain; charset=utf-8\r\n\r\nSynthetic body"
    for level in range(depth):
        boundary = f"synthetic-{level}".encode()
        data = (b'Content-Type: multipart/mixed; boundary="' + boundary + b'"\r\n\r\n'
                + b"--" + boundary + b"\r\n" + data + b"\r\n--" + boundary + b"--\r\n")
    if parts > 1:
        data = (b'Content-Type: multipart/mixed; boundary="parts"\r\n\r\n'
                + (b"--parts\r\nContent-Type: text/plain\r\n\r\nSynthetic part\r\n" * parts)
                + b"--parts--\r\n")
    return data


def payload(case: dict) -> tuple[bytes, str]:
    rng = random.Random(case["seed"])
    kind = case["kind"]
    variant = case["variant"]
    text = "Booking reference: SYNTHETIC-ONLY\nCancellation: Synthetic non-refundable terms."
    if kind in ("plain", "utf8"):
        data = text.encode()
        for _ in range(1 + variant % 16):
            where = rng.randrange(len(data) + 1)
            data = data[:where] + bytes([rng.randrange(256)]) + data[where:]
        return data, "text/plain"
    if kind == "html":
        tags = ("div", "p", "span", "script", "template", "iframe", "svg", "noscript")
        attrs = ("hidden", 'aria-hidden="true"', 'style="display:none"', "inert", "")
        body = text
        for _ in range(variant % 100):
            tag = rng.choice(tags)
            body = f"<{tag} {rng.choice(attrs)}>{body}</{tag}>"
        body += '<img src="https://asset.example.invalid/synthetic">'
        if variant % 3 == 0:
            body += "<!-- Synthetic hidden marker -->" * (variant % 20)
        return body.encode(), "text/html"
    if kind == "docx":
        out = io.BytesIO()
        inner = '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'
        xml = ('<w:document xmlns:w="urn:synthetic"><w:body>' + inner + '</w:body></w:document>')
        if variant % 7 == 0:
            xml = '<!DOCTYPE a [<!ENTITY x "synthetic">]><a>&x;</a>'
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(zipfile.ZipInfo("word/document.xml", (2020, 1, 1, 0, 0, 0)), xml, compress_type=zipfile.ZIP_DEFLATED)
            if variant % 4 == 0:
                archive.writestr(zipfile.ZipInfo("../synthetic-escape", (2020, 1, 1, 0, 0, 0)), "synthetic", compress_type=zipfile.ZIP_DEFLATED)
        data = out.getvalue()
        if variant % 5 == 0:
            data = data[:rng.randrange(1, len(data))]
        return data, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if kind == "pdf":
        from pypdf import PdfWriter
        writer = PdfWriter()
        side = 50000 if variant % 5 == 0 else 72
        writer.add_blank_page(width=side, height=side)
        out = io.BytesIO()
        writer.write(out)
        data = out.getvalue()
        if variant % 3 == 0:
            data = data[:rng.randrange(8, len(data))]
        elif variant % 3 == 1:
            where = rng.randrange(8, len(data))
            data = data[:where] + bytes([rng.randrange(256)]) + data[where + 1:]
        return data, "application/pdf"
    if kind == "eml_attachment":
        return (b'MIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="outer"\r\n\r\n'
                b'--outer\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nOuter synthetic body.\r\n'
                b'--outer\r\nContent-Type: message/rfc822\r\nContent-Disposition: attachment; filename="synthetic.eml"\r\n\r\n'
                b'Content-Type: text/plain; charset=utf-8\r\n\r\nBooking reference: SYNTHETIC-ATTACHMENT-ONLY\r\n'
                b'--outer--\r\n'), "message/rfc822"
    if kind == "eml_text_limit":
        return b"Content-Type: text/plain; charset=utf-8\r\n\r\n" + b"x" * 150001, "message/rfc822"
    if kind == "eml":
        depth = (0, 1, 5, 32, 64, 128, 256, 512, 1100)[variant % 9]
        return mime_message(depth, (variant % 70) + 1 if variant % 10 == 0 else 1), "message/rfc822"
    raise ValueError("UNKNOWN_FUZZ_TARGET")


def worker() -> None:
    memory_limit = False
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
        resource.setrlimit(resource.RLIMIT_CPU, (7, 7))
        memory_limit = True
    except ImportError:
        pass
    sys.path.insert(0, str(ROOT / "ingest"))
    import socket

    import travel_ingest.extract as module
    from travel_ingest.extract import ExtractionError
    # OCR accuracy is a separate native test; no Tesseract process in this campaign.
    module._ocr = lambda _image: "Booking reference: SYNTHETIC-OCR-STUB"
    def deny_network(*_args, **_kwargs):
        raise RuntimeError("FUZZ_NETWORK_ATTEMPT")
    socket.getaddrinfo = deny_network
    socket.socket.connect = deny_network
    socket.socket.sendto = deny_network
    request = json.load(sys.stdin)
    print(json.dumps({"phase": "ready"}), flush=True)
    for case in request:
        print(json.dumps({"phase": "start", "id": case["id"], "kind": case["kind"]}), flush=True)
        start = time.monotonic()
        data, media = payload(case)
        record = {"phase": "done", "id": case["id"], "kind": case["kind"], "bytes": len(data),
                  "sha256": hashlib.sha256(data).hexdigest(), "memoryLimitApplied": memory_limit}
        try:
            assert payload(case)[0] == data, "NONDETERMINISTIC_RECIPE"
            result = module.extract(data, media)
            assert result["status"] == "needs_review", "UNCONFIRMED_STATE_LOST"
            assert len(result["fields"]) <= 300 and len(result.get("facts", [])) <= 30, "FIELD_LIMIT"
            assert len(result["snippets"]) <= 50, "SNIPPET_LIMIT"
            assert all(f["state"] == "extracted" and len(f["source"]["quote"]) <= 600 for f in result["fields"]), "SOURCE_BOUNDS"
            if case["kind"] == "eml_attachment":
                assert all("SYNTHETIC-ATTACHMENT-ONLY" not in s["text"] for s in result["snippets"]), "ATTACHMENT_SUBTREE_DISCLOSED"
            if case["kind"] == "eml_text_limit":
                raise AssertionError("OVERSIZED_EML_SILENTLY_TRUNCATED")
            json.dumps(result, allow_nan=False)
            record["outcome"] = "accepted"
        except ExtractionError as error:
            record.update(outcome="rejected", code=str(error) if re.fullmatch(r"[A-Z_]{1,100}", str(error)) else "PARSE_REJECTED")
        except (AssertionError, RecursionError, MemoryError) as error:
            code = str(error) if re.fullmatch(r"[A-Z_]{1,100}", str(error)) else type(error).__name__
            record.update(outcome="finding", code=code)
        except Exception as error:  # noqa: BLE001 - record unexpected fuzz outcomes without a traceback
            # A malformed document can legitimately fail its format parser. Keep
            # its class for triage; never print document contents or traceback.
            known = {"UnicodeDecodeError", "PdfReadError", "EmptyFileError", "PdfStreamError", "BadZipFile", "ParseError", "EntitiesForbidden", "DTDForbidden", "UnidentifiedImageError", "ValueError", "KeyError", "LookupError", "InvalidDataError", "PdfiumError"}
            record.update(outcome="rejected" if type(error).__name__ in known else "finding", code=type(error).__name__)
        record["seconds"] = round(time.monotonic() - start, 6)
        print(json.dumps(record), flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--seed", type=int, default=20261030)
    parser.add_argument("--cases", type=int, default=600)
    parser.add_argument("--seconds", type=int, default=120)
    parser.add_argument("--output", default=".local/security-audit/fuzz/ingest.json")
    args = parser.parse_args()
    if args.worker:
        if sys.flags.optimize:
            raise SystemExit("Run fuzz properties without optimized assertions")
        worker()
        return 0
    if not 1 <= args.cases <= 20000 or not 1 <= args.seconds <= 600:
        parser.error("Budgets outside allowed range")
    output = (ROOT / args.output).resolve()
    safe_root = (ROOT / ".local/security-audit/fuzz").resolve()
    if not output.is_relative_to(safe_root):
        parser.error("Reports must stay in .local/security-audit/fuzz")
    output.parent.mkdir(parents=True, exist_ok=True)
    source_names = ["ingest/travel_ingest/extract.py", "ingest/travel_ingest/html_safety.py", "ingest/travel_ingest/literal_facts.py"]
    before = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in source_names}
    rng = random.Random(args.seed)
    cases = [{"id": i, "kind": KINDS[i % len(KINDS)], "seed": rng.randrange(2**32), "variant": rng.randrange(2000)} for i in range(args.cases)]
    records = []
    findings = []
    infrastructure_issues = []
    startup_retries = 0
    start = time.monotonic()
    for offset in range(0, len(cases), 16):
        # Do not turn exhaustion of the whole campaign budget into an alleged
        # parser timeout by starting a batch with less than its full deadline.
        if args.seconds - (time.monotonic() - start) < 12:
            break
        batch = cases[offset:offset + 16]
        for attempt in range(2):
            timeout = min(12, max(0.1, args.seconds - (time.monotonic() - start)))
            try:
                result = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker"], input=json.dumps(batch), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", timeout=timeout, check=False)
                lines = result.stdout.splitlines()
                timed_out = False
                exit_code = result.returncode
            except subprocess.TimeoutExpired as error:
                raw = error.stdout or b""
                lines = raw.decode("utf-8", errors="replace").splitlines() if isinstance(raw, bytes) else raw.splitlines()
                timed_out = True
                exit_code = None
            parsed = []
            for line in lines:
                try:
                    parsed.append(json.loads(line))
                except ValueError:
                    pass
            if timed_out and not any(r.get("phase") == "start" for r in parsed) and attempt == 0 and args.seconds - (time.monotonic() - start) > 12:
                startup_retries += 1
                continue
            break
        done = [r for r in parsed if r.get("phase") == "done"]
        records.extend(done)
        for record in done:
            if record["outcome"] == "finding":
                findings.append(record)
        if timed_out or exit_code:
            last = next((r for r in reversed(parsed) if r.get("phase") == "start"), {"id": batch[0]["id"], "kind": batch[0]["kind"]})
            if not any(r.get("phase") == "start" for r in parsed):
                infrastructure_issues.append({"batch": offset, "code": "WORKER_BOOTSTRAP_TIMEOUT" if timed_out else "WORKER_BOOTSTRAP_EXIT", "exitCode": exit_code})
            else:
                findings.append({**last, "outcome": "finding", "code": "BATCH_TIMEOUT" if timed_out else "WORKER_EXIT", "exitCode": exit_code})
    for finding in findings[:20]:
        recipe = cases[finding["id"]]
        (output.parent / f'case-{finding["id"]}.json').write_text(json.dumps(recipe, indent=2) + "\n", encoding="utf-8")
    changed = any(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != digest for name, digest in before.items())
    summary = {"status": "FAIL" if findings else "INCOMPLETE" if len(records) != args.cases or changed or infrastructure_issues else "PASS",
               "tool": "seeded-mutation-ingest", "python": platform.python_version(), "seed": args.seed,
               "requestedCases": args.cases, "completedCases": len(records), "seconds": round(time.monotonic() - start, 3),
               "batchWallTimeoutSeconds": 12, "posixMemoryLimitBytes": 1024**3,
               "maxCompletedCaseSeconds": max((r["seconds"] for r in records), default=0),
               "memoryLimitApplied": any(r.get("memoryLimitApplied") for r in records),
               "nativeOcr": "stubbed; native PDF parser/render path remains exercised", "network": "socket operations denied",
               "counts": dict(Counter(r["outcome"] for r in records)), "findingCodes": dict(Counter(r["code"] for r in findings)),
               "findings": findings[:20], "uniquePayloadHashes": len({r["sha256"] for r in records}),
               "startupRetriesBeforeAnyCase": startup_retries, "infrastructureIssues": infrastructure_issues,
               "packages": {name: importlib.metadata.version(name) for name in ("pypdf", "pypdfium2", "Pillow", "beautifulsoup4", "defusedxml")},
               "scope": "seeded structured mutations, not coverage-guided or exhaustive parser fuzzing"}
    summary["sources"] = before
    summary["sourceChangedDuringRun"] = changed
    output.write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k != "findings"}))
    return 1 if findings else 2 if len(records) != args.cases or changed or infrastructure_issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
