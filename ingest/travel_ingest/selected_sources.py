"""Local, explicitly selected workbook, archive entry and PDF page ingestion."""

import argparse
import hashlib
import io
import json
import posixpath
import re
import stat
from datetime import date, datetime, timedelta
from pathlib import Path, PurePosixPath
from zipfile import ZipFile

from defusedxml import ElementTree
from pypdf import PdfReader

from travel_ingest.extract import extract

LIMIT = 20 * 1024 * 1024
XML_LIMIT = 4 * 1024 * 1024
ROWS_LIMIT = 300
CELL = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,5})$")
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def require(condition, code):
    if not condition:
        raise ValueError(code)


def fingerprint(data):
    return hashlib.sha256(data).hexdigest()


def checked_archive(archive):
    members = archive.infolist()
    require(len(members) <= 700, "SOURCE_ARCHIVE_ENTRY_LIMIT")
    names = set()
    for entry in members:
        name = entry.filename
        relative = PurePosixPath(name)
        require(
            bool(relative.parts) and not relative.is_absolute() and ".." not in relative.parts
            and not any(x in name for x in ("\\", ":", "\x00"))
            and not stat.S_ISLNK(entry.external_attr >> 16) and not entry.flag_bits & 1
            and name not in names,
            "SOURCE_ARCHIVE_UNSAFE_ENTRY",
        )
        names.add(name)
    return names


def read_entry(archive, name, limit):
    entry = archive.getinfo(name)
    require(not entry.is_dir() and entry.file_size <= limit, "SOURCE_ENTRY_SIZE")
    require(entry.file_size <= max(1, entry.compress_size) * 200, "SOURCE_ENTRY_RATIO")
    with archive.open(entry) as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "SOURCE_ENTRY_SIZE")
    return data


def parse_date(value, date1904):
    if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return date.fromisoformat(value).isoformat()
    if isinstance(value, (int, float)) and 0 < value < 100000 and value == int(value):
        serial = int(value)
        require(date1904 or serial != 60, "INVALID_EXCEL_DATE")
        origin = date(1904, 1, 1) if date1904 else date(1899, 12, 31)
        return (origin + timedelta(days=serial - (not date1904 and serial > 60))).isoformat()
    return None


def parse_time(value):
    if isinstance(value, (int, float)) and 0 <= value < 1:
        exact = value * 1440
        minutes = round(exact)
        if abs(exact - minutes) < 1e-5 and minutes < 1440:
            return f"{minutes // 60:02d}:{minutes % 60:02d}"
    if isinstance(value, str):
        match = re.fullmatch(r"(\d{1,2})(?:[hH:]([0-5]\d)?(?::00)?)?", value.strip().rstrip("'"))
        if match and int(match[1]) < 24:
            return f"{int(match[1]):02d}:{int(match[2] or '0'):02d}"
    return None


def agenda_fragment(result, source_id, prefix, observed_at, offset):
    require(
        all(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,45}", item) for item in (source_id, prefix))
        and re.fullmatch(r"(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)", offset),
        "SOURCE_AGENDA_FRAGMENT",
    )
    moment = datetime.fromisoformat(observed_at)
    require(moment.tzinfo is not None, "SOURCE_OBSERVATION_NEEDS_OFFSET")
    facts = []
    for row in result["rows"]:
        require(len(row["label"]) <= 300, "SOURCE_CELL_TEXT_LIMIT")
        key = f"{prefix}-r{row['row']}"
        local = f"{row['date']}T{row['time']}:00{offset}" if row["date"] and row["time"] else None
        facts.extend([
            {"id": key + "-label", "value": row["label"], "sourceIds": [source_id]},
            {"id": key + "-start", "value": local, "sourceIds": [source_id]},
        ])
    return {
        "source": {"id": source_id, "kind": "agenda", "origin": "local", "digest": result["sourceSha256"],
                   "observedAt": moment.isoformat(), "expiresAt": None, "locator": result["sheet"]},
        "facts": facts,
    }


def selected_agenda(data, *, sheet, first, last, date_col, time_col, label_col, carry_date=False):
    columns = [date_col, time_col, label_col]
    require(
        len(data) <= LIMIT and 1 <= first <= last <= 999999 and last - first < ROWS_LIMIT
        and len(set(columns)) == 3 and all(re.fullmatch(r"[A-Z]{1,3}", column) for column in columns),
        "SOURCE_AGENDA_SELECTION",
    )
    with ZipFile(io.BytesIO(data)) as archive:
        names = checked_archive(archive)
        require(not any("vbaproject" in name.lower() for name in names), "SOURCE_WORKBOOK_MACROS")
        workbook = ElementTree.fromstring(read_entry(archive, "xl/workbook.xml", XML_LIMIT))
        relations = ElementTree.fromstring(read_entry(archive, "xl/_rels/workbook.xml.rels", XML_LIMIT))
        properties = workbook.find(NS + "workbookPr")
        date1904 = properties is not None and properties.get("date1904") in {"1", "true"}
        matching = [node for node in workbook.iter(NS + "sheet") if node.get("name") == sheet]
        require(len(matching) == 1, "SOURCE_SHEET_NOT_FOUND")
        links = [node for node in relations if node.get("Id") == matching[0].get(REL + "id")]
        require(
            len(links) == 1 and links[0].get("TargetMode", "Internal") == "Internal"
            and links[0].get("Type", "").endswith("/worksheet"),
            "SOURCE_SHEET_LINK_INVALID",
        )
        target = links[0].get("Target", "")
        filename = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
        require(re.fullmatch(r"xl/worksheets/[A-Za-z0-9_.-]+\.xml", filename), "SOURCE_SHEET_LINK_INVALID")
        grid = ElementTree.fromstring(read_entry(archive, filename, XML_LIMIT))
        shared = []
        if "xl/sharedStrings.xml" in names:
            strings = ElementTree.fromstring(read_entry(archive, "xl/sharedStrings.xml", XML_LIMIT))
            shared = ["".join(x.text or "" for x in node.iter(NS + "t")) for node in strings]

    cells = {}
    for node in grid.iter(NS + "c"):
        address = CELL.fullmatch(node.get("r", ""))
        if not address or address[1] not in columns or not first <= int(address[2]) <= last:
            continue
        require(address[0] not in cells, "SOURCE_DUPLICATE_CELL")
        raw = node.findtext(NS + "v")
        cell_type = node.get("t", "n")
        if node.find(NS + "f") is not None:
            value = None
        elif cell_type == "inlineStr":
            value = "".join(item.text or "" for item in node.iter(NS + "t"))
        elif cell_type == "s" and raw and raw.isdigit():
            index = int(raw)
            require(index < len(shared), "SOURCE_SHARED_STRING_INVALID")
            value = shared[index]
        elif cell_type == "n" and raw:
            value = float(raw)
        else:
            value = raw
        if isinstance(value, str):
            require(len(value) <= 600, "SOURCE_CELL_TEXT_LIMIT")
        cells[address[0]] = value

    result = []
    current_date = None
    date_cell = None
    for row in range(first, last + 1):
        date_ref, time_ref, label_ref = [column + str(row) for column in columns]
        if date_ref in cells:
            current_date = parse_date(cells[date_ref], date1904)
            date_cell = date_ref
        elif not carry_date:
            current_date, date_cell = None, None
        label = cells.get(label_ref)
        if isinstance(label, str) and label.strip():
            result.append({
                "row": row, "label": label.strip(), "date": current_date, "time": parse_time(cells.get(time_ref)),
                "cells": {"date": date_cell, "time": time_ref, "label": label_ref},
                "status": "schedule_observation",
            })
    return {"sourceSha256": fingerprint(data), "sheet": sheet, "rows": result}


def pdf_pages(data, first, last):
    require(data.startswith(b"%PDF-") and len(data) <= LIMIT, "SOURCE_PDF_INVALID")
    reader = PdfReader(io.BytesIO(data), strict=True)
    require(not reader.is_encrypted and 1 <= first <= last <= min(len(reader.pages), 1000)
            and last - first < 50, "SOURCE_PDF_PAGE_RANGE")
    pages = []
    size = 0
    for number in range(first, last + 1):
        value = reader.pages[number - 1].extract_text() or ""
        size += len(value)
        require(size <= 400000, "SOURCE_PDF_TEXT_LIMIT")
        pages.append({"page": number, "text": value, "status": "extracted" if value.strip() else "requires_ocr"})
    return {"sourceSha256": fingerprint(data), "pageCount": len(reader.pages), "pages": pages}


def main():
    parser = argparse.ArgumentParser(description="Read selected private travel sources.")
    parser.add_argument("mode", choices=["agenda", "pdf", "attachment"])
    parser.add_argument("file", type=Path)
    parser.add_argument("--entry")
    parser.add_argument("--sheet", default="")
    parser.add_argument("--first", type=int, default=1)
    parser.add_argument("--last", type=int, default=1)
    parser.add_argument("--date-column", default="A")
    parser.add_argument("--time-column", default="B")
    parser.add_argument("--label-column", default="C")
    parser.add_argument("--carry-date", action="store_true")
    parser.add_argument("--source-id")
    parser.add_argument("--fact-prefix")
    parser.add_argument("--observed-at")
    parser.add_argument("--utc-offset")
    args = parser.parse_args()
    try:
        require(args.file.is_file() and args.file.stat().st_size <= LIMIT, "SOURCE_FILE_SIZE")
        with args.file.open("rb") as stream:
            data = stream.read(LIMIT + 1)
        require(len(data) <= LIMIT, "SOURCE_FILE_SIZE")
        container = None
        if args.entry:
            with ZipFile(io.BytesIO(data)) as archive:
                checked_archive(archive)
                container = {"sha256": fingerprint(data), "entry": args.entry}
                data = read_entry(archive, args.entry, LIMIT)
        fragment_args = [args.source_id, args.fact_prefix, args.observed_at, args.utc_offset]
        require(not any(fragment_args) or (args.mode == "agenda" and all(fragment_args)), "SOURCE_AGENDA_FRAGMENT")
        if args.mode == "agenda":
            result = selected_agenda(
                data, sheet=args.sheet, first=args.first, last=args.last,
                date_col=args.date_column, time_col=args.time_column, label_col=args.label_column,
                carry_date=args.carry_date,
            )
            if all(fragment_args):
                result.update(agenda_fragment(result, *fragment_args))
        elif args.mode == "pdf":
            result = pdf_pages(data, args.first, args.last)
        else:
            require(args.entry, "SOURCE_ATTACHMENT_SELECTION_REQUIRED")
            media_type = {".eml": "message/rfc822", ".pdf": "application/pdf", ".png": "image/png",
                          ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".html": "text/html"}.get(
                              PurePosixPath(args.entry).suffix.lower())
            require(media_type, "SOURCE_ATTACHMENT_FORMAT_UNSUPPORTED")
            result = {"sourceSha256": fingerprint(data), "extraction": extract(data, media_type)}
        print(json.dumps({"container": container, **result}, ensure_ascii=True))
    except Exception as error:
        message = str(error)
        parser.exit(1, (message if re.fullmatch(r"[A-Z_]+", message) else "SOURCE_REJECTED") + "\n")


if __name__ == "__main__":
    main()
