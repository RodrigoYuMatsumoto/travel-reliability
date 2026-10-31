import asyncio
import json
import os
import sys
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.requests import ClientDisconnect

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
gate = asyncio.Semaphore(1)
MAX_BYTES = 20 * 1024 * 1024
active_requests = 0


@app.get("/health")
async def health():
    return {"status": "ok", "parserVersion": "1.0.0"}


@app.post("/extract")
async def extraction(request: Request):
    global active_requests
    if active_requests >= 2:
        return JSONResponse({"errorCode": "INGEST_CAPACITY"}, 503)
    active_requests += 1
    body = bytearray()
    try:
        async with gate:
            async with asyncio.timeout(30):
                async for chunk in request.stream():
                    body.extend(chunk)
                    if len(body) > MAX_BYTES:
                        return JSONResponse({"errorCode": "SIZE_LIMIT"}, 413)
            if not body:
                return JSONResponse({"errorCode": "EMPTY_DOCUMENT"}, 400)
            child_env = {
                key: os.environ[key] for key in ("PATH", "SYSTEMROOT", "WINDIR") if key in os.environ
            }
            # HOME is only a sandbox hint, not an opened or predictable file.
            child_env.update({"PYTHONIOENCODING": "utf-8", "PYTHONDONTWRITEBYTECODE": "1", "HOME": "/tmp"})  # nosec B108
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                "travel_ingest.worker",
                request.headers.get("content-type", "").split(";")[0],
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=child_env,
                cwd=str(Path(__file__).resolve().parent.parent),
            )

            async def disconnected():
                while not await request.is_disconnected():
                    await asyncio.sleep(0.2)

            async def communicate_bounded():
                process.stdin.write(bytes(body))
                await process.stdin.drain()
                process.stdin.close()
                output = bytearray()
                while chunk := await process.stdout.read(65536):
                    output.extend(chunk)
                    if len(output) > 2 * 1024 * 1024:
                        raise ValueError("OUTPUT_LIMIT")
                await process.wait()
                return bytes(output), None

            communication = asyncio.create_task(communicate_bounded())
            connection = asyncio.create_task(disconnected())
            try:
                done, _ = await asyncio.wait(
                    {communication, connection}, timeout=120, return_when=asyncio.FIRST_COMPLETED
                )
                if communication not in done:
                    process.kill()
                    await process.wait()
                    return JSONResponse(
                        {"errorCode": "CLIENT_DISCONNECTED" if connection in done else "DOCUMENT_TIMEOUT"},
                        422,
                    )
                try:
                    output, _ = await communication
                except (ValueError, BrokenPipeError, ConnectionResetError):
                    return JSONResponse({"errorCode": "DOCUMENT_OUTPUT_LIMIT_OR_FAILURE"}, 422)
                try:
                    result = json.loads(output)
                except (ValueError, UnicodeDecodeError):
                    return JSONResponse({"errorCode": "DOCUMENT_PARSE_FAILED"}, 422)
                return JSONResponse(result, 200 if process.returncode == 0 else 422)
            finally:
                if process.returncode is None:
                    process.kill()
                    await process.wait()
                for task in (communication, connection):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(communication, connection, return_exceptions=True)
    except TimeoutError:
        return JSONResponse({"errorCode": "UPLOAD_TIMEOUT"}, 408)
    except ClientDisconnect:
        return JSONResponse({"errorCode": "CLIENT_DISCONNECTED"}, 499)
    finally:
        body.clear()
        active_requests -= 1
