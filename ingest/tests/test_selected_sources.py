import io
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

import pytest
from pypdf import PdfWriter

from travel_ingest.selected_sources import agenda_fragment, pdf_pages, selected_agenda

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def archive(files):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as output:
        for name, data in files.items():
            output.writestr(name, data)
    return stream.getvalue()


def workbook():
    return archive({
        "xl/workbook.xml": (
            f'<workbook xmlns="{MAIN}" xmlns:r="{OFFICE}"><sheets>'
            '<sheet name="Current" sheetId="1" r:id="rId1"/>'
            '<sheet name="Archive" sheetId="2" r:id="rId2"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            f'<Relationships><Relationship Id="rId1" Type="{OFFICE}/worksheet" Target="worksheets/sheet1.xml"/>'
            f'<Relationship Id="rId2" Type="{OFFICE}/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'
        ),
        "xl/worksheets/sheet1.xml": (
            f'<worksheet xmlns="{MAIN}"><sheetData>'
            '<row r="3"><c r="C3" t="d"><v>2032-01-08</v></c>'
            '<c r="D3"><v>0.375</v></c><c r="E3" t="inlineStr"><is><t>Company A</t></is></c>'
            '<c r="F3" t="inlineStr"><is><t>Other team</t></is></c></row>'
            '<row r="4"><c r="D4" t="inlineStr"><is><t>10h30</t></is></c>'
            '<c r="E4" t="s"><v>0</v></c></row>'
            '<row r="5"><c r="D5"><f>1+1</f><v>0.5</v></c>'
            '<c r="E5" t="inlineStr"><is><t>Needs a time</t></is></c></row>'
            '</sheetData></worksheet>'
        ),
        "xl/worksheets/sheet2.xml": f'<worksheet xmlns="{MAIN}"><sheetData/></worksheet>',
        "xl/sharedStrings.xml": f'<sst xmlns="{MAIN}"><si><t>Company B</t></si></sst>',
    })


def test_imports_only_selected_sheet_and_columns_with_cell_provenance():
    result = selected_agenda(
        workbook(), sheet="Current", first=3, last=5,
        date_col="C", time_col="D", label_col="E", carry_date=True,
    )
    rows = result["rows"]
    assert [item["label"] for item in rows] == ["Company A", "Company B", "Needs a time"]
    assert [item["time"] for item in rows] == ["09:00", "10:30", None]
    assert rows[1]["cells"] == {"date": "C3", "time": "D4", "label": "E4"}
    fragment = agenda_fragment(result, "source1", "agenda", "2032-01-01T00:00:00Z", "+01:00")
    assert fragment["facts"][3]["value"] == "2032-01-08T10:30:00+01:00"
    assert fragment["facts"][5]["value"] is None
    assert fragment["source"]["digest"] == result["sourceSha256"]


def test_reads_only_the_selected_archive_attachment_and_rejects_unsafe_inventory(tmp_path):
    file = tmp_path / "synthetic.zip"
    message = b"Subject: Synthetic\r\n\r\nBooking reference: SAMPLE1"
    file.write_bytes(archive({"selected.eml": message, "other.eml": b"never copied"}))
    command = [sys.executable, "-m", "travel_ingest.selected_sources", "attachment", str(file), "--entry",
               "selected.eml"]
    cwd = Path(__file__).resolve().parents[1]
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=10, check=False)
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout)["container"]["entry"] == "selected.eml"
    assert "never copied" not in result.stdout
    file.write_bytes(archive({"selected.eml": message, "../outside.eml": b"test"}))
    result = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=10, check=False)
    assert result.returncode == 1 and "SOURCE_ARCHIVE_UNSAFE_ENTRY" in result.stderr


def test_long_policy_pdf_keeps_original_page_numbers_and_bounded_selection():
    stream = io.BytesIO()
    writer = PdfWriter()
    for _ in range(83):
        writer.add_blank_page(width=100, height=100)
    writer.write(stream)
    data = stream.getvalue()
    result = pdf_pages(data, 82, 83)
    assert result["pageCount"] == 83
    assert [page["page"] for page in result["pages"]] == [82, 83]
    assert all(page["status"] == "requires_ocr" for page in result["pages"])
    with pytest.raises(ValueError, match="SOURCE_PDF_PAGE_RANGE"):
        pdf_pages(data, 1, 51)
