"""Treat every byte as untrusted data. Extraction never executes instructions or fetches URLs."""

from __future__ import annotations

import io
import math
import re
import warnings
import zipfile
from email import policy
from email.parser import BytesParser
from html import unescape
from typing import Any

from bs4 import BeautifulSoup
from defusedxml import ElementTree
from PIL import Image, ImageOps
from pypdf import PdfReader

MAX_BYTES = 20 * 1024 * 1024
MAX_PAGES = 50
MAX_TEXT = 150_000
Image.MAX_IMAGE_PIXELS = 25_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
INJECTION_MARKERS = re.compile(
    r"ignore\s+(?:all\s+)?(?:previous|system|instru)|(?:system|developer)\s*prompt|"
    r"(?:execute|run)\s+(?:python|shell|bash)|(?:exfiltrat|ignoreRobotsText)|"
    r"(?:ignorar|ignore)\s+(?:as\s+)?instru[çc][õo]es",
    re.I,
)


class ExtractionError(ValueError):
    pass


def _ocr(image: Image.Image) -> str:
    import pytesseract

    if image.width * image.height > 25_000_000:
        raise ExtractionError("IMAGE_PIXEL_LIMIT")
    try:
        return pytesseract.image_to_string(
            ImageOps.exif_transpose(image).convert("RGB"), lang="por+eng", timeout=20
        )
    except (pytesseract.TesseractNotFoundError, RuntimeError, pytesseract.TesseractError) as exc:
        raise ExtractionError("OCR_UNAVAILABLE_OR_TIMEOUT") from exc


def _text_pages(data: bytes, media_type: str) -> list[tuple[int, str, str]]:
    if media_type == "application/pdf":
        if not data.startswith(b"%PDF-"):
            raise ExtractionError("MEDIA_TYPE_MISMATCH")
        reader = PdfReader(io.BytesIO(data), strict=True)
        if reader.is_encrypted:
            raise ExtractionError("ENCRYPTED_PDF_REQUIRES_LOCAL_DECRYPTION")
        if len(reader.pages) > MAX_PAGES:
            raise ExtractionError("PAGE_LIMIT")
        result = []
        document = None
        try:
            for number, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ""
                if len(text) > MAX_TEXT:
                    raise ExtractionError("TEXT_LIMIT")
                method = "text"
                if len(text.strip()) < 20:
                    import pypdfium2 as pdfium

                    if document is None:
                        document = pdfium.PdfDocument(data)
                    width, height = float(page.mediabox.width), float(page.mediabox.height)
                    if (
                        not all(math.isfinite(value) and value > 0 for value in (width, height))
                        or math.ceil(width * 1.5) * math.ceil(height * 1.5) > 25_000_000
                    ):
                        raise ExtractionError("IMAGE_PIXEL_LIMIT")
                    pdf_page = document[number - 1]
                    bitmap = pdf_page.render(scale=1.5)
                    try:
                        text = _ocr(bitmap.to_pil())
                    finally:
                        bitmap.close()
                        pdf_page.close()
                    method = "ocr"
                result.append((number, text[:MAX_TEXT], method))
                if sum(len(item[1]) for item in result) > MAX_TEXT:
                    raise ExtractionError("TEXT_LIMIT")
            return result
        finally:
            if document is not None:
                document.close()
    if media_type in ("image/png", "image/jpeg"):
        valid_magic = (
            data.startswith(b"\x89PNG\r\n\x1a\n")
            if media_type == "image/png"
            else data.startswith(b"\xff\xd8\xff")
        )
        if not valid_magic:
            raise ExtractionError("MEDIA_TYPE_MISMATCH")
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            return [(1, _ocr(image), "ocr")]
    if media_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            if len(entries) > 500 or sum(item.file_size for item in entries) > MAX_BYTES:
                raise ExtractionError("ARCHIVE_LIMIT")
            if any(
                "vbaproject" in item.filename.lower()
                or item.filename.startswith("/")
                or ".." in item.filename.split("/")
                for item in entries
            ):
                raise ExtractionError("UNSAFE_ARCHIVE")
            if any(item.file_size > max(1, item.compress_size) * 100 for item in entries):
                raise ExtractionError("ARCHIVE_RATIO_LIMIT")
            root = ElementTree.fromstring(archive.read("word/document.xml"))
            text = "\n".join("".join(p.itertext()) for p in root.iter() if p.tag.endswith("}p"))
            if len(text) > MAX_TEXT:
                raise ExtractionError("TEXT_LIMIT")
            return [(1, text[:MAX_TEXT], "text")]
    if media_type == "message/rfc822":
        message = BytesParser(policy=policy.default).parsebytes(data)
        texts: list[str] = []
        for part in message.walk():
            if part.get_content_disposition() == "attachment":
                continue
            if part.get_content_type() == "text/plain":
                texts.append(str(part.get_content()))
        return [(1, "\n".join(texts)[:MAX_TEXT], "text")]
    text = data.decode("utf-8", errors="strict")
    if len(text) > MAX_TEXT:
        raise ExtractionError("TEXT_LIMIT")
    if media_type == "text/html":
        soup = BeautifulSoup(text, "html.parser")
        for element in soup(["script", "style", "iframe", "object", "embed", "svg"]):
            element.decompose()
        text = soup.get_text("\n")
    elif media_type not in ("text/plain", "application/json"):
        raise ExtractionError("UNSUPPORTED_MEDIA_TYPE")
    return [(1, unescape(text)[:MAX_TEXT], "text")]


def extract(data: bytes, media_type: str) -> dict[str, Any]:
    if not data or len(data) > MAX_BYTES:
        raise ExtractionError("SIZE_LIMIT")
    pages = _text_pages(data, media_type)
    warnings = []
    fields: list[dict[str, Any]] = []
    snippets = []
    for number, text, method in pages:
        if INJECTION_MARKERS.search(text):
            warnings.append("UNTRUSTED_INSTRUCTION_DETECTED")
        if re.search(r"[\u200b-\u200f\u2060\U000e0000-\U000e007f]", text):
            warnings.append("INVISIBLE_CHARACTERS_REQUIRE_REVIEW")
        for line_number, line in enumerate(text.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            patterns = {
                "reservation.reference": r"(?:localizador|booking\s*(?:reference|code)|reservation\s*(?:reference|code)|pnr)\s*[:#]\s*([A-Z0-9-]{3,40})",
                "cancellation.summary": r"((?:cancelamento|cancellation|reembolso|refund).{0,500})",
                "baggage": r"((?:bagagem|baggage|luggage).{0,500})",
            }
            for path, pattern in patterns.items():
                match = re.search(pattern, line, re.I)
                if match:
                    fields.append(
                        {
                            "path": path,
                            "value": match.group(1),
                            "state": "extracted",
                            "method": method,
                            "source": {"page": number, "line": line_number, "quote": line[:600]},
                        }
                    )
            if len(snippets) < 50:
                snippets.append({"page": number, "line": line_number, "text": line[:600]})
    if not fields:
        warnings.append("NO_STRUCTURED_FIELDS_FOUND")
    # Deliberately no inferred identity, dates, prices or confirmation status.
    return {
        "parserVersion": "1.0.0",
        "fields": fields[:300],
        "warnings": sorted(set(warnings)),
        "pageCount": len(pages),
        "snippets": snippets,
        "status": "needs_review",
    }
