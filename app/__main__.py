from __future__ import annotations

from importlib import import_module


def main() -> int:
    uvicorn = import_module("uvicorn")
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
