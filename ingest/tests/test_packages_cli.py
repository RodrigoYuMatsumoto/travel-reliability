"""CLI: sorted JSON on stdout, stable error codes on stderr, fetch needs --allow-network."""

import io
import json
import subprocess
import sys
from pathlib import Path

from travel_ingest.packages.cli import main

INGEST = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).parent / "fixtures" / "packages"
OBSERVED_AT = "2026-11-04T12:00:00-03:00"


def run(argv: list[str]) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    code = main(argv, stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def test_parse_prints_the_golden_json():
    code, out, err = run(
        [
            "parse",
            "--html-file",
            str(FIXTURES / "niel_detail.html"),
            "--url",
            "https://niel.example.invalid/pacote/destino-sintetico",
            "--observed-at",
            OBSERVED_AT,
            "--site",
            "niel",
        ]
    )
    assert code == 0 and err == ""
    assert out == (FIXTURES / "expected" / "niel_detail.json").read_text(encoding="utf-8")


def test_listing_command():
    code, out, _ = run(
        [
            "listing",
            "--html-file",
            str(FIXTURES / "valle_listing.html"),
            "--url",
            "https://valle.example.invalid/home?offset=9&limit=9",
            "--observed-at",
            OBSERVED_AT,
            "--site",
            "valle",
        ]
    )
    assert code == 0
    assert len(json.loads(out)) == 3


def test_missing_file_is_a_stable_error():
    code, out, err = run(
        [
            "parse",
            "--html-file",
            str(FIXTURES / "nao-existe.html"),
            "--url",
            "https://a.example.invalid/",
            "--observed-at",
            OBSERVED_AT,
        ]
    )
    assert code == 2 and out == ""
    assert json.loads(err) == {"error": "HTML_FILE_UNREADABLE"}


def test_fetch_without_allow_network_is_refused():
    code, out, err = run(
        ["fetch", "--url", "https://www.atrativatur.com.br/viagem.php?v=1", "--observed-at", OBSERVED_AT]
    )
    assert code == 2 and out == ""
    assert json.loads(err) == {"error": "NETWORK_NOT_ALLOWED"}


def test_module_entry_point_runs_offline():
    completed = subprocess.run(
        [
            sys.executable,
            "-m",
            "travel_ingest.packages",
            "parse",
            "--html-file",
            str(FIXTURES / "augustus_static_shell.html"),
            "--url",
            "https://augustus.example.invalid/#/pacote/7",
            "--observed-at",
            OBSERVED_AT,
            "--site",
            "augustus",
            "--retrieval",
            "static_html",
        ],
        cwd=INGEST,
        capture_output=True,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    result = json.loads(completed.stdout.decode("utf-8"))
    assert result["warnings"] == ["RENDER_REQUIRED", "STATIC_SHELL_NOT_EVIDENCE"]
    assert list(result) == sorted(result)
