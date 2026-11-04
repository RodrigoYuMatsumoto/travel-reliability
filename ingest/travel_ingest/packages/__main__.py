"""Entry point for ``python -m travel_ingest.packages``."""

import sys

from .cli import main

if __name__ == "__main__":
    reconfigure = getattr(sys.stdout, "reconfigure", None)
    if reconfigure is not None:
        reconfigure(encoding="utf-8")
    raise SystemExit(main())
