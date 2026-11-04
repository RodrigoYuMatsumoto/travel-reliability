"""Command line: ``python -m travel_ingest.packages parse|listing|fetch``.

Output is JSON with sorted keys. Errors print ``{"error": "<CODE>"}`` to stderr and exit 2.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import TextIO

from . import parse_listing, parse_package
from .common import MAX_HTML_BYTES, RETRIEVALS, SITES
from .errors import PackageError


def dumps(value) -> str:
    """Canonical serialisation used by the CLI and the golden files."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n"


def _read_html(path: str) -> str:
    file = Path(path)
    try:
        if file.stat().st_size > MAX_HTML_BYTES:
            raise PackageError("HTML_TOO_LARGE")
        data = file.read_bytes()
    except OSError:
        raise PackageError("HTML_FILE_UNREADABLE") from None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        raise PackageError("HTML_NOT_UTF8") from None


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m travel_ingest.packages")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("parse", "listing"):
        command = commands.add_parser(name)
        command.add_argument("--html-file", required=True)
        command.add_argument("--url", required=True)
        command.add_argument("--observed-at", required=True)
        command.add_argument("--site", choices=SITES)
        command.add_argument("--retrieval", choices=RETRIEVALS, default="fixture")
    fetch = commands.add_parser("fetch")
    fetch.add_argument("--url", required=True)
    fetch.add_argument("--observed-at", required=True)
    fetch.add_argument("--allow-network", action="store_true")
    fetch.add_argument("--site", choices=SITES)
    fetch.add_argument("--then", choices=("raw", "parse", "listing"), default="raw")
    return parser


def main(argv: list[str] | None = None, stdout: TextIO | None = None, stderr: TextIO | None = None) -> int:
    out = stdout or sys.stdout
    err = stderr or sys.stderr
    args = _parser().parse_args(argv)
    try:
        if args.command == "fetch":
            from .fetch import fetch_rendered

            fetched = fetch_rendered(args.url, observed_at=args.observed_at, allow_network=args.allow_network)
            common = {
                "url": fetched["url"],
                "observed_at": args.observed_at,
                "retrieval": fetched["retrieval"],
            }
            if args.then == "parse":
                result = parse_package(fetched["html"], site=args.site, **common)
            elif args.then == "listing":
                result = parse_listing(fetched["html"], site=args.site, **common)
            else:
                result = fetched
        else:
            html = _read_html(args.html_file)
            function = parse_package if args.command == "parse" else parse_listing
            result = function(
                html, url=args.url, observed_at=args.observed_at, retrieval=args.retrieval, site=args.site
            )
    except PackageError as error:
        err.write(json.dumps({"error": error.code}) + "\n")
        return 2
    out.write(dumps(result))
    return 0
