import io
import os
import shutil

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from travel_ingest.extract import extract
from travel_ingest.server import app


def test_actual_worker_subprocess_for_passive_text():
    with TestClient(app) as client:
        response = client.post(
            "/extract", content=b"Baggage: synthetic allowance only", headers={"content-type": "text/plain"}
        )
    assert response.status_code == 200
    assert response.json()["fields"][0]["state"] == "extracted"
    assert response.json()["fields"][0]["source"]["page"] == 1


def test_actual_native_ocr_on_generated_image():
    if not shutil.which("tesseract"):
        if os.environ.get("REQUIRE_NATIVE_OCR") == "1":
            pytest.fail("Tesseract required by this verification environment")
        pytest.skip("Native Tesseract unavailable; required in CI")
    image = Image.new("RGB", (1800, 200), "white")
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", 48)
    except OSError:
        font = ImageFont.load_default(size=48)
    ImageDraw.Draw(image).text((30, 60), "Baggage: SYNTHETIC ALLOWANCE ONLY", fill="black", font=font)
    content = io.BytesIO()
    image.save(content, format="PNG")
    result = extract(content.getvalue(), "image/png")
    assert any(field["path"] == "baggage" and field["method"] == "ocr" for field in result["fields"])
    assert result["status"] == "needs_review"
