ARG PLAYWRIGHT_BASE
FROM ${PLAYWRIGHT_BASE}
ARG PLAYWRIGHT_BASE
RUN python3 -c "import os,re; assert re.fullmatch(r'mcr.microsoft.com/playwright/python:v1[.]64[.]1-noble@sha256:[a-f0-9]{64}', os.environ['PLAYWRIGHT_BASE'])"
WORKDIR /app
COPY deploy/renderer/requirements.txt /app/requirements.txt
RUN python3 -m pip install --no-cache-dir --require-hashes --only-binary=:all: --index-url https://pypi.org/simple -r /app/requirements.txt
RUN groupadd --gid 10001 renderer && useradd --uid 10001 --gid 10001 --create-home renderer
COPY ingest/travel_ingest/packages/render_worker.py /app/render_worker.py
LABEL org.travel-reliability.renderer="travel-reliability-renderer/1"
ENV HOME=/home/renderer PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 LANG=C.UTF-8
USER 10001:10001
ENTRYPOINT ["python3", "-I", "-B", "/app/render_worker.py"]
CMD []
