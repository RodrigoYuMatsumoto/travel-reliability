"""Reduced synthetic corpus retained from the seeded mutation campaign."""

import random

import pytest

from travel_ingest.extract import ExtractionError, extract


def test_fuzz_eml_attachment_subtrees_are_never_extracted():
    for newline in (b"\r\n", b"\n"):
        for disposition in (b'attachment; filename="synthetic.eml"', b'ATTACHMENT; filename="synthetic.eml"', b'inline; filename="synthetic.eml"'):
            raw = newline.join([
                b'MIME-Version: 1.0', b'Content-Type: multipart/mixed; boundary="outer"', b'',
                b'--outer', b'Content-Type: text/plain; charset=utf-8', b'', b'Outer synthetic body.',
                b'--outer', b'Content-Type: message/rfc822', b'Content-Disposition: ' + disposition,
                b'', b'Content-Type: text/plain; charset=utf-8', b'',
                b'Booking reference: SYNTHETIC-ATTACHMENT-ONLY', b'--outer--', b'',
            ])
            result = extract(raw, "message/rfc822")
            assert all("SYNTHETIC-ATTACHMENT-ONLY" not in item["text"] for item in result["snippets"])
            assert all(field["value"] != "SYNTHETIC-ATTACHMENT-ONLY" for field in result["fields"])


def test_fuzz_eml_total_text_over_limit_is_rejected():
    prefix = b"Content-Type: text/plain; charset=utf-8\r\n\r\n"
    extract(prefix + b"x" * 150000, "message/rfc822")
    for count in (150001, 180000):
        with pytest.raises(ExtractionError, match="TEXT_LIMIT"):
            extract(prefix + b"x" * count, "message/rfc822")
    aggregate = (b'Content-Type: multipart/mixed; boundary="parts"\r\n\r\n'
                 + (b'--parts\r\nContent-Type: text/plain\r\n\r\n' + b'x' * 80000 + b'\r\n') * 2
                 + b'--parts--\r\n')
    with pytest.raises(ExtractionError, match="TEXT_LIMIT"):
        extract(aggregate, "message/rfc822")


def test_fuzz_eml_deep_or_wide_structure_is_bounded():
    deep = b"Content-Type: text/plain\r\n\r\nSynthetic body"
    for index in range(64):
        boundary = f"synthetic-{index}".encode()
        deep = (b'Content-Type: multipart/mixed; boundary="' + boundary + b'"\r\n\r\n--'
                + boundary + b'\r\n' + deep + b'\r\n--' + boundary + b'--\r\n')
    wide = (b'Content-Type: multipart/mixed; boundary="parts"\r\n\r\n'
            + b'--parts\r\nContent-Type: text/plain\r\n\r\nSynthetic part\r\n' * 257
            + b'--parts--\r\n')
    for raw in (deep, wide):
        with pytest.raises(ExtractionError):
            extract(raw, "message/rfc822")


def test_fuzz_utf8_mutations_are_rejected_or_source_bounded():
    rng = random.Random(20261030)
    seed = b"Booking reference: SYNTHETIC-ONLY\nBaggage: synthetic allowance"
    for _ in range(256):
        data = bytearray(seed)
        for _ in range(rng.randrange(1, 8)):
            data.insert(rng.randrange(len(data) + 1), rng.randrange(256))
        try:
            result = extract(bytes(data), "text/plain")
        except (UnicodeDecodeError, ExtractionError):
            continue
        assert result["status"] == "needs_review"
        assert all(field["state"] == "extracted" and len(field["source"]["quote"]) <= 600 for field in result["fields"])
