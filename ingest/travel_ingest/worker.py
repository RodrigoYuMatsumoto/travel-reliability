"""Single-job child process. Only input bytes and MIME type cross its boundary."""

import json
import sys

from travel_ingest.extract import ExtractionError, extract

try:
    import resource

    resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_CPU, (110, 110))
    resource.setrlimit(resource.RLIMIT_FSIZE, (20 * 1024**2, 20 * 1024**2))
except ImportError:
    pass

if __name__ == "__main__":
    try:
        result = extract(sys.stdin.buffer.read(20 * 1024**2 + 1), sys.argv[1])
        sys.stdout.write(json.dumps(result, ensure_ascii=False))
    except ExtractionError as error:
        sys.stdout.write(json.dumps({"errorCode": str(error)}))
        sys.exit(2)
    except Exception:
        sys.stdout.write(json.dumps({"errorCode": "DOCUMENT_PARSE_FAILED"}))
        sys.exit(2)
