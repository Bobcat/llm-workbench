from __future__ import annotations

import argparse
import time
from pathlib import Path

from app.core import TranslationCore
from app.events import load_pc_events
from app.replay import ReplayRunner, ReplayTrace
from app.replay_settings import load_replay_settings
from app.translators import Ct2EuroLlmTranslator, build_translator


def _shorten(text: str, *, limit: int = 72) -> str:
    value = str(text or "")
    if len(value) <= limit:
        return value
    return value[: limit - 3] + "..."


def _visible_target_text(trace: ReplayTrace) -> str:
    committed = trace.target_state.target_committed_text
    preview = trace.target_state.target_preview_text
    if not committed or not preview:
        return f"{committed}{preview}"
    if committed.endswith((" ", "\n")) or preview.startswith((" ", "\n")):
        return f"{committed}{preview}"
    return f"{committed} {preview}"


def _format_trace(trace: ReplayTrace, *, verbose: bool) -> str:
    preview_state = "empty" if trace.source_state.source_preview_text == "" else "set"
    translated = "yes" if trace.decision.triggered else "no"
    parts = [
        f"{trace.event_index:04d}",
        trace.event.kind,
        f"committed_chars={len(trace.source_state.source_committed_text)}",
        f"preview={preview_state}",
        f"translated={translated}",
    ]
    if trace.decision.triggered:
        parts.append(f"source_chunks={trace.decision.source_chunks_used}")
        parts.append(f"window={_shorten(trace.decision.source_window)!r}")
        parts.append(f"target={_shorten(_visible_target_text(trace))!r}")
        parts.append(f"latency_ms={trace.decision.latency_ms:.1f}")
    elif verbose:
        parts.append(f"preview_text={_shorten(trace.source_state.source_preview_text)!r}")
    return " | ".join(parts)


def _dump_end_state(runner: ReplayRunner) -> str:
    source_state = runner.source_state
    target_state = runner.core.target_state
    lines = [
        "END STATE",
        f"source_committed_text={source_state.source_committed_text!r}",
        f"source_preview_text={source_state.source_preview_text!r}",
        f"committed_chunks={source_state.committed_chunks!r}",
        f"target_committed_text={target_state.target_committed_text!r}",
        f"target_preview_text={target_state.target_preview_text!r}",
    ]
    return "\n".join(lines)


def _collect_first_committed_text(path: Path, *, committed_events: int) -> str:
    chunks: list[str] = []
    for event in load_pc_events(path):
        if event.kind != "c":
            continue
        chunks.append(event.text)
        if len(chunks) >= committed_events:
            break
    if len(chunks) < committed_events:
        raise SystemExit(
            f"{path}: only found {len(chunks)} committed events, need {committed_events}"
        )
    return "".join(chunks)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Replay historical transcript events for translation simulation.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    replay_parser = subparsers.add_parser("replay", help="Replay a .pc transcript event file.")
    replay_parser.add_argument("path", type=Path, help="Path to a .pc file.")
    replay_parser.add_argument("--verbose", action="store_true", help="Show more trace detail.")
    replay_parser.add_argument("--max-events", type=int, default=None, help="Stop after N events.")
    replay_parser.add_argument(
        "--translator",
        choices=("dummy", "ct2-eurollm"),
        default="dummy",
        help="Translator backend to use.",
    )
    replay_parser.add_argument(
        "--dummy-mode",
        choices=("marker", "echo"),
        default="marker",
        help="Dummy translator output style.",
    )
    replay_parser.add_argument("--dump-end-state", action="store_true", help="Print final source/target state.")

    replay_web_parser = subparsers.add_parser("replay-web", help="Start a browser UI for replay traces.")
    replay_web_parser.add_argument("path", type=Path, help="Path to a .pc file.")
    replay_web_parser.add_argument("--max-events", type=int, default=None, help="Stop after N events.")
    replay_web_parser.add_argument(
        "--translator",
        choices=("dummy", "ct2-eurollm"),
        default="dummy",
        help="Translator backend to use.",
    )
    replay_web_parser.add_argument(
        "--dummy-mode",
        choices=("marker", "echo"),
        default="marker",
        help="Dummy translator output style.",
    )
    replay_web_parser.add_argument("--host", default="127.0.0.1", help="Bind host for the local web server.")
    replay_web_parser.add_argument("--port", type=int, default=8000, help="Bind port for the local web server.")

    smoke_parser = subparsers.add_parser("smoke", help="Send the first N committed chunks as one request to EuroLLM.")
    smoke_parser.add_argument("path", type=Path, help="Path to a .pc file.")
    smoke_parser.add_argument("--c-count", type=int, default=10, help="Number of committed events to combine.")

    judge_parser = subparsers.add_parser("judge-web", help="Start a small browser UI for prompt A/B judging.")
    judge_parser.add_argument("path", type=Path, help="Path to a .pc file.")
    judge_parser.add_argument("--window-chunks", type=int, default=2, help="Committed chunks per judge item.")
    judge_parser.add_argument("--max-items", type=int, default=20, help="Maximum judge items to expose.")
    judge_parser.add_argument(
        "--comparison-prompt",
        choices=(
            "baseline_topk5_temp03",
            "baseline_nl",
            "faithful_nl_compact",
            "natural_nl",
            "simple_nl",
            "spoken_nl",
            "superior_nl",
            "syntactic_nl",
        ),
        default="natural_nl",
        help="Second prompt to compare against baseline.",
    )
    judge_parser.add_argument("--host", default="127.0.0.1", help="Bind host for the local web server.")
    judge_parser.add_argument("--port", type=int, default=8000, help="Bind port for the local web server.")
    judge_parser.add_argument(
        "--results-path",
        type=Path,
        default=Path("tmp/judge-results.jsonl"),
        help="Where to append browser judgments as JSONL.",
    )
    return parser


def run_replay(args: argparse.Namespace) -> int:
    translator = build_translator(args.translator, dummy_mode=args.dummy_mode)
    settings = load_replay_settings()
    core = TranslationCore(
        translator=translator,
        preview_settings=settings.preview_translation,
        context_committed_chunks=settings.context_committed_chunks,
    )
    runner = ReplayRunner(core=core)
    traces = runner.run_path(args.path, max_events=args.max_events)
    for trace in traces:
        print(_format_trace(trace, verbose=args.verbose))
    if args.dump_end_state:
        print()
        print(_dump_end_state(runner))
    return 0


def run_smoke(args: argparse.Namespace) -> int:
    translator = Ct2EuroLlmTranslator()
    source_text = _collect_first_committed_text(args.path, committed_events=args.c_count)
    started = time.perf_counter()
    target_text = translator.translate(source_text)
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    print("SMOKE RESULT")
    print(f"committed_events={args.c_count}")
    print(f"source_chars={len(source_text)}")
    print("SOURCE")
    print(source_text)
    print("TARGET")
    print(target_text)
    print(f"latency_ms={elapsed_ms:.1f}")
    return 0


def run_judge_web(args: argparse.Namespace) -> int:
    import uvicorn
    from app.judge_web import create_judge_app

    app = create_judge_app(
        path=args.path,
        window_chunks=args.window_chunks,
        max_items=args.max_items,
        results_path=args.results_path,
        comparison_prompt_name=args.comparison_prompt,
    )
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def run_replay_web(args: argparse.Namespace) -> int:
    import uvicorn
    from app.replay_web import create_replay_app

    app = create_replay_app(
        path=args.path,
        translator_name=args.translator,
        dummy_mode=args.dummy_mode,
        max_events=args.max_events,
    )
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "replay":
        return run_replay(args)
    if args.command == "smoke":
        return run_smoke(args)
    if args.command == "replay-web":
        return run_replay_web(args)
    if args.command == "judge-web":
        return run_judge_web(args)
    parser.error(f"unsupported command: {args.command!r}")
    return 2
