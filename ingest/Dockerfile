FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev
COPY travel_ingest ./travel_ingest
RUN useradd --uid 10001 --create-home parser
ENV PATH=/app/.venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
USER parser
EXPOSE 8081
CMD ["python", "-m", "uvicorn", "travel_ingest.server:app", "--host", "0.0.0.0", "--port", "8081", "--no-access-log"]
