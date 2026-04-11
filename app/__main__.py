from __future__ import annotations

import argparse
from pathlib import Path

from app.smoke_runner import run_smoke


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="LLM Workbench CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    smoke_parser = subparsers.add_parser(
        "smoke", help="Send the first N committed chunks as one request to EuroLLM."
    )
    smoke_parser.add_argument("path", type=Path, help="Path to a .pc file.")
    smoke_parser.add_argument(
        "--c-count", type=int, default=10, help="Number of committed events to combine."
    )

    args = parser.parse_args(argv)

    if args.command == "smoke":
        try:
            result = run_smoke(args.path, committed_events=args.c_count)
            print("SMOKE RESULT")
            print(f"committed_events={result.committed_events}")
            print(f"source_chars={result.source_chars}")
            print("SOURCE")
            print(result.source_text)
            print("TARGET")
            print(result.target_text)
            print(f"latency_ms={result.latency_ms:.1f}")
            return 0
        except ValueError as e:
            print(f"Error: {e}")
            return 1

    parser.error(f"unsupported command: {args.command!r}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
