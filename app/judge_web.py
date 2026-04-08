from __future__ import annotations

import html
import json
import random
from collections import Counter
from collections import defaultdict
from dataclasses import asdict
from dataclasses import dataclass
from datetime import UTC
from datetime import datetime
from pathlib import Path
from threading import Lock

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from fastapi.responses import RedirectResponse
from fastapi.responses import Response
from pydantic import BaseModel

from app.events import load_pc_events
from app.translators import Ct2EuroLlmTranslator

BASELINE_PROMPT_NAME = "baseline"
BASELINE_NL_PROMPT_NAME = "baseline_nl"
NATURAL_PROMPT_NAME = "natural_nl"
SIMPLE_PROMPT_NAME = "simple_nl"
SUPERIOR_PROMPT_NAME = "superior_nl"
FAITHFUL_NL_COMPACT_PROMPT_NAME = "faithful_nl_compact"
SPOKEN_NL_PROMPT_NAME = "spoken_nl"
SYNTACTIC_NL_PROMPT_NAME = "syntactic_nl"
BASELINE_TOPK5_TEMP03_PROMPT_NAME = "baseline_topk5_temp03"


@dataclass(frozen=True)
class VariantSpec:
    system_prompt: str
    beam_size: int = 1
    sampling_topk: int = 1
    sampling_temperature: float = 0.1


PROMPT_VARIANTS = {
    BASELINE_PROMPT_NAME: VariantSpec(
        system_prompt="You are a translation engine. Translate the user's text into Dutch. Return only the translation."
    ),
    BASELINE_NL_PROMPT_NAME: VariantSpec(
        system_prompt="Je bent een vertaalsysteem. Vertaal de tekst van de gebruiker naar het Nederlands. Geef alleen de vertaling terug."
    ),
    NATURAL_PROMPT_NAME: VariantSpec(
        system_prompt=(
        "You are a translation engine. Translate the user's text into Dutch. "
        "Use natural Dutch word order. Reorder clauses when needed. Do not mirror the source order. "
        "Split long sentences when needed. Return only the translation."
        )
    ),
    SIMPLE_PROMPT_NAME: VariantSpec(system_prompt="Translate the user's text into Dutch."),
    SUPERIOR_PROMPT_NAME: VariantSpec(
        system_prompt="You are a superior translator. Translate the text into easy to read syntactically correct Dutch. Return only the translation."
    ),
    FAITHFUL_NL_COMPACT_PROMPT_NAME: VariantSpec(
        system_prompt=(
        "Translate the user's text into natural Dutch. "
        "Stay close to the source. "
        "Keep names, product names, and version labels unchanged. "
        "Do not add, explain, or guess. "
        "Return only the translation."
        )
    ),
    SPOKEN_NL_PROMPT_NAME: VariantSpec(
        system_prompt="You are a translation engine. Translate the user's spoken text into natural Dutch. Return only the translation."
    ),
    SYNTACTIC_NL_PROMPT_NAME: VariantSpec(
        system_prompt=(
        "IDENTITY\n"
        "You are a translation engine.\n\n"
        "TASK\n"
        "Translate the user's spoken text into Dutch.\n\n"
        "RULES\n"
        "- Return only the translation."
    ),
    ),
    BASELINE_TOPK5_TEMP03_PROMPT_NAME: VariantSpec(
        system_prompt="You are a translation engine. Translate the user's text into Dutch. Return only the translation.",
        beam_size=1,
        sampling_topk=5,
        sampling_temperature=0.3,
    ),
}


@dataclass(frozen=True)
class JudgeItem:
    item_index: int
    line_number: int
    committed_count: int
    source_window: str


def build_judge_items(path: str | Path, *, window_chunks: int, max_items: int | None = None) -> list[JudgeItem]:
    items: list[JudgeItem] = []
    committed_chunks: list[str] = []
    committed_count = 0
    for event in load_pc_events(path):
        if event.kind != "c":
            continue
        committed_count += 1
        committed_chunks.append(event.text)
        source_window = "\n".join(chunk for chunk in committed_chunks[-window_chunks:] if chunk)
        items.append(
            JudgeItem(
                item_index=len(items),
                line_number=event.line_number,
                committed_count=committed_count,
                source_window=source_window,
            )
        )
        if max_items is not None and len(items) >= max_items:
            break
    return items


def append_vote(results_path: str | Path, payload: dict[str, object]) -> None:
    path = Path(results_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=True) + "\n")


def load_vote_rows(results_path: str | Path) -> list[dict[str, object]]:
    path = Path(results_path)
    if not path.exists():
        return []

    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def build_run_summary(results_path: str | Path) -> dict[str, object]:
    rows = load_vote_rows(results_path)
    latest_by_item: dict[int, dict[str, object]] = {}
    row_counts: Counter[int] = Counter()

    for row in rows:
        item_index = int(row["item_index"])
        latest_by_item[item_index] = row
        row_counts[item_index] += 1

    unique_rows = [latest_by_item[item_index] for item_index in sorted(latest_by_item)]
    wins: Counter[str] = Counter()
    nonidentical_wins: Counter[str] = Counter()
    ties = 0
    nonidentical_ties = 0
    items: list[dict[str, object]] = []
    a_assignments: dict[str, list[int]] = defaultdict(list)
    b_assignments: dict[str, list[int]] = defaultdict(list)
    identical_item_numbers: list[int] = []
    variant_names_seen: set[str] = set()

    for row in unique_rows:
        item_index = int(row["item_index"])
        item_number = item_index + 1
        variant_a = str(row["variant_a"])
        variant_b = str(row["variant_b"])
        output_a = str(row["output_a"])
        output_b = str(row["output_b"])
        identical_outputs = output_a == output_b

        variant_names_seen.add(variant_a)
        variant_names_seen.add(variant_b)
        a_assignments[variant_a].append(item_number)
        b_assignments[variant_b].append(item_number)

        if identical_outputs:
            identical_item_numbers.append(item_number)

        winner_value = str(row["winner"])
        if winner_value == "A":
            winner_variant = variant_a
            wins[winner_variant] += 1
            if not identical_outputs:
                nonidentical_wins[winner_variant] += 1
        elif winner_value == "B":
            winner_variant = variant_b
            wins[winner_variant] += 1
            if not identical_outputs:
                nonidentical_wins[winner_variant] += 1
        else:
            winner_variant = "tie"
            ties += 1
            if not identical_outputs:
                nonidentical_ties += 1

        items.append(
            {
                "item_number": item_number,
                "line_number": int(row["line_number"]),
                "variant_a": variant_a,
                "variant_b": variant_b,
                "winner_variant": winner_variant,
                "identical_outputs": identical_outputs,
            }
        )

    duplicate_item_numbers = [item_index + 1 for item_index, count in sorted(row_counts.items()) if count > 1]

    return {
        "rows_logged": len(rows),
        "unique_items": len(unique_rows),
        "duplicate_rows": len(rows) - len(unique_rows),
        "duplicate_item_numbers": duplicate_item_numbers,
        "variant_names": sorted(variant_names_seen),
        "a_assignments": {name: numbers for name, numbers in a_assignments.items()},
        "b_assignments": {name: numbers for name, numbers in b_assignments.items()},
        "identical_item_numbers": identical_item_numbers,
        "wins": dict(wins),
        "nonidentical_wins": dict(nonidentical_wins),
        "ties": ties,
        "nonidentical_ties": nonidentical_ties,
        "items": items,
    }


def _ordered_summary_variants(summary: dict[str, object]) -> list[str]:
    variant_names = list(summary["variant_names"])
    if BASELINE_PROMPT_NAME in variant_names:
        return [BASELINE_PROMPT_NAME] + [name for name in variant_names if name != BASELINE_PROMPT_NAME]
    return variant_names


def _variant_spec(name: str) -> VariantSpec:
    return PROMPT_VARIANTS.get(name, VariantSpec(system_prompt=""))


def build_run_export_text(results_path: str | Path) -> str:
    summary = build_run_summary(results_path)
    ordered_variants = _ordered_summary_variants(summary)
    rows = load_vote_rows(results_path)
    latest_by_item: dict[int, dict[str, object]] = {}
    for row in rows:
        latest_by_item[int(row["item_index"])] = row

    lines: list[str] = []
    prompt_1 = ordered_variants[0] if ordered_variants else ""
    prompt_2 = ordered_variants[1] if len(ordered_variants) > 1 else ""
    lines.append(f"prompt#1={prompt_1}")
    lines.append(f"prompt#1_text={_variant_spec(prompt_1).system_prompt}")
    lines.append(f"prompt#1_decode={json.dumps(asdict(_variant_spec(prompt_1)), ensure_ascii=True)}")
    lines.append(f"prompt#2={prompt_2}")
    lines.append(f"prompt#2_text={_variant_spec(prompt_2).system_prompt}")
    lines.append(f"prompt#2_decode={json.dumps(asdict(_variant_spec(prompt_2)), ensure_ascii=True)}")
    lines.append("")

    for item_index in sorted(latest_by_item):
        row = latest_by_item[item_index]
        outputs_by_variant = {
            str(row["variant_a"]): str(row["output_a"]),
            str(row["variant_b"]): str(row["output_b"]),
        }
        lines.append(f"item#={item_index + 1}")
        lines.append("item input:")
        lines.append(str(row["source_window"]))
        lines.append("item output prompt#1:")
        lines.append(outputs_by_variant.get(prompt_1, ""))
        lines.append("item output prompt#2:")
        lines.append(outputs_by_variant.get(prompt_2, ""))
        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


class VoteSubmission(BaseModel):
    item_index: int
    winner: str
    naturalness: int | None = None
    faithfulness: int | None = None
    variant_a: str
    variant_b: str


class JudgeService:
    def __init__(
        self,
        *,
        path: str | Path,
        window_chunks: int,
        max_items: int | None,
        results_path: str | Path,
        comparison_prompt_name: str = NATURAL_PROMPT_NAME,
    ) -> None:
        self.path = Path(path)
        self.window_chunks = window_chunks
        self.max_items = max_items
        self.results_path = Path(results_path)
        if comparison_prompt_name not in PROMPT_VARIANTS:
            raise ValueError(f"unsupported comparison prompt: {comparison_prompt_name!r}")
        if comparison_prompt_name == BASELINE_PROMPT_NAME:
            raise ValueError("comparison_prompt_name must differ from baseline")
        self.comparison_prompt_name = comparison_prompt_name
        self.items = build_judge_items(self.path, window_chunks=window_chunks, max_items=max_items)
        self._translator: Ct2EuroLlmTranslator | None = None
        self._translator_lock = Lock()
        self._output_cache: dict[tuple[int, str], str] = {}
        self._output_lock = Lock()

    def total_items(self) -> int:
        return len(self.items)

    def get_item(self, item_index: int) -> JudgeItem:
        if item_index < 0 or item_index >= len(self.items):
            raise IndexError(item_index)
        return self.items[item_index]

    def render_variants(self, item_index: int) -> tuple[str, str]:
        randomizer = random.Random(item_index)
        variant_names = [BASELINE_PROMPT_NAME, self.comparison_prompt_name]
        randomizer.shuffle(variant_names)
        return variant_names[0], variant_names[1]

    def render_output(self, item_index: int, prompt_name: str) -> str:
        cache_key = (item_index, prompt_name)
        with self._output_lock:
            cached = self._output_cache.get(cache_key)
        if cached is not None:
            return cached

        item = self.get_item(item_index)
        output = self._get_translator().translate_with_system_prompt(
            item.source_window,
            system_prompt=_variant_spec(prompt_name).system_prompt,
            beam_size=_variant_spec(prompt_name).beam_size,
            sampling_topk=_variant_spec(prompt_name).sampling_topk,
            sampling_temperature=_variant_spec(prompt_name).sampling_temperature,
        )
        with self._output_lock:
            self._output_cache[cache_key] = output
        return output

    def record_vote(self, submission: VoteSubmission) -> None:
        item = self.get_item(submission.item_index)
        if submission.winner not in {"A", "B", "tie"}:
            raise ValueError(f"unsupported winner: {submission.winner!r}")
        if submission.variant_a not in PROMPT_VARIANTS:
            raise ValueError(f"unsupported variant_a: {submission.variant_a!r}")
        if submission.variant_b not in PROMPT_VARIANTS:
            raise ValueError(f"unsupported variant_b: {submission.variant_b!r}")

        payload = {
            "timestamp_utc": datetime.now(UTC).isoformat(),
            "path": str(self.path),
            "item_index": item.item_index,
            "line_number": item.line_number,
            "committed_count": item.committed_count,
            "window_chunks": self.window_chunks,
            "winner": submission.winner,
            "naturalness": submission.naturalness,
            "faithfulness": submission.faithfulness,
            "variant_a": submission.variant_a,
            "variant_b": submission.variant_b,
            "source_window": item.source_window,
            "output_a": self.render_output(item.item_index, submission.variant_a),
            "output_b": self.render_output(item.item_index, submission.variant_b),
        }
        append_vote(self.results_path, payload)

    def _get_translator(self) -> Ct2EuroLlmTranslator:
        with self._translator_lock:
            if self._translator is None:
                self._translator = Ct2EuroLlmTranslator(max_length=512)
            return self._translator


def create_judge_app(
    *,
    path: str | Path,
    window_chunks: int = 2,
    max_items: int | None = 20,
    results_path: str | Path = Path("tmp/judge-results.jsonl"),
    comparison_prompt_name: str = NATURAL_PROMPT_NAME,
) -> FastAPI:
    service = JudgeService(
        path=path,
        window_chunks=window_chunks,
        max_items=max_items,
        results_path=results_path,
        comparison_prompt_name=comparison_prompt_name,
    )
    app = FastAPI(title="Translation Judge")

    @app.get("/", response_class=HTMLResponse)
    def index(item: int = 0) -> HTMLResponse:
        if service.total_items() == 0:
            return HTMLResponse("<h1>No committed items found.</h1>", status_code=200)
        if item >= service.total_items():
            return HTMLResponse(_render_done_page(service), status_code=200)
        try:
            judge_item = service.get_item(item)
        except IndexError as exc:
            raise HTTPException(status_code=404, detail="item not found") from exc

        variant_a, variant_b = service.render_variants(item)
        output_a = service.render_output(item, variant_a)
        output_b = service.render_output(item, variant_b)
        return HTMLResponse(
            _render_item_page(
                judge_item=judge_item,
                total_items=service.total_items(),
                variant_a=variant_a,
                variant_b=variant_b,
                output_a=output_a,
                output_b=output_b,
            ),
            status_code=200,
        )

    @app.post("/api/vote")
    def vote(submission: VoteSubmission) -> RedirectResponse:
        try:
            service.record_vote(submission)
        except (IndexError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        next_item = submission.item_index + 1
        return RedirectResponse(url=f"/?item={next_item}", status_code=303)

    @app.get("/summary", response_class=HTMLResponse)
    def summary() -> HTMLResponse:
        return HTMLResponse(_render_summary_page(service), status_code=200)

    @app.get("/summary.txt")
    def summary_text() -> Response:
        return Response(
            content=build_run_export_text(service.results_path),
            media_type="text/plain",
            headers={"Content-Disposition": 'attachment; filename="judge-summary.txt"'},
        )

    return app


def _render_item_page(
    *,
    judge_item: JudgeItem,
    total_items: int,
    variant_a: str,
    variant_b: str,
    output_a: str,
    output_b: str,
) -> str:
    source_html = html.escape(judge_item.source_window)
    output_a_html = html.escape(output_a)
    output_b_html = html.escape(output_b)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Translation Judge</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f2ea;
      --panel: #fffdf8;
      --ink: #1e1b18;
      --muted: #73675c;
      --line: #d9cfc2;
      --accent: #a94124;
      --accent-soft: #f7dfd2;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, #efe0cf 0, transparent 30%),
        radial-gradient(circle at top right, #ece6d8 0, transparent 25%),
        var(--bg);
      color: var(--ink);
    }}
    .shell {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1;
      letter-spacing: -0.03em;
    }}
    .meta {{
      color: var(--muted);
      margin-bottom: 24px;
      font-size: 0.95rem;
    }}
    .source,
    .choice {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 18px;
      box-shadow: 0 12px 24px rgba(41, 31, 21, 0.05);
    }}
    .source {{
      margin-bottom: 20px;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }}
    .choice label {{
      display: block;
      font-weight: 700;
      margin-bottom: 10px;
    }}
    pre {{
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      font-family: inherit;
      line-height: 1.5;
      font-size: 1rem;
    }}
    fieldset {{
      border: 0;
      margin: 20px 0 12px;
      padding: 0;
    }}
    .controls {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    button {{
      border: 1px solid var(--accent);
      background: var(--accent-soft);
      color: var(--ink);
      border-radius: 999px;
      padding: 12px 16px;
      font: inherit;
      cursor: pointer;
    }}
    .scores {{
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    select {{
      width: 100%;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--line);
      font: inherit;
      background: white;
    }}
    .submit {{
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }}
    .error {{
      color: #8a1c16;
      min-height: 1.2em;
    }}
    @media (max-width: 900px) {{
      .grid,
      .controls,
      .scores {{
        grid-template-columns: 1fr;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <h1>Translation Judge</h1>
    <div class="meta">Item {judge_item.item_index + 1} / {total_items} · committed #{judge_item.committed_count} · line {judge_item.line_number}</div>

    <section class="source">
      <label><strong>Source Window</strong></label>
      <pre>{source_html}</pre>
    </section>

    <section class="grid">
      <article class="choice">
        <label>Output A</label>
        <pre>{output_a_html}</pre>
      </article>
      <article class="choice">
        <label>Output B</label>
        <pre>{output_b_html}</pre>
      </article>
    </section>

    <fieldset>
      <legend><strong>Winner</strong></legend>
      <div class="controls">
        <button type="button" onclick="submitVote('A')">A Is Better</button>
        <button type="button" onclick="submitVote('B')">B Is Better</button>
        <button type="button" onclick="submitVote('tie')">Tie</button>
      </div>
    </fieldset>

    <div class="scores">
      <label>Naturalness
        <select id="naturalness">
          <option value="">No score</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </label>
      <label>Faithfulness
        <select id="faithfulness">
          <option value="">No score</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
        </select>
      </label>
    </div>

    <div class="submit">
      <span class="error" id="error"></span>
    </div>
  </div>
  <script>
    async function submitVote(winner) {{
      const payload = {{
        item_index: {judge_item.item_index},
        winner,
        naturalness: document.getElementById('naturalness').value || null,
        faithfulness: document.getElementById('faithfulness').value || null,
        variant_a: {json.dumps(variant_a)},
        variant_b: {json.dumps(variant_b)}
      }};
      const response = await fetch('/api/vote', {{
        method: 'POST',
        headers: {{ 'Content-Type': 'application/json' }},
        body: JSON.stringify(payload)
      }});
      if (response.redirected) {{
        window.location.href = response.url;
        return;
      }}
      const detail = await response.text();
      document.getElementById('error').textContent = detail || 'Vote failed';
    }}
  </script>
</body>
</html>"""


def _render_done_page(service: JudgeService) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Translation Judge</title>
  <style>
    body {{
      margin: 0;
      padding: 48px 20px;
      font-family: Georgia, "Times New Roman", serif;
      background: #f6f2ea;
      color: #1e1b18;
    }}
    .card {{
      max-width: 720px;
      margin: 0 auto;
      background: #fffdf8;
      border: 1px solid #d9cfc2;
      border-radius: 18px;
      padding: 24px;
    }}
    .actions {{
      margin-top: 20px;
    }}
    .button {{
      display: inline-block;
      border: 1px solid #a94124;
      background: #f7dfd2;
      color: #1e1b18;
      border-radius: 999px;
      padding: 12px 16px;
      text-decoration: none;
      font: inherit;
    }}
  </style>
</head>
<body>
  <div class="card">
    <h1>Done</h1>
    <p>All {service.total_items()} items have been judged.</p>
    <p>Results file: {html.escape(str(service.results_path))}</p>
    <div class="actions">
      <a class="button" href="/summary">View Run Summary</a>
    </div>
  </div>
</body>
</html>"""


def _render_summary_page(service: JudgeService) -> str:
    summary = build_run_summary(service.results_path)
    ordered_variants = _ordered_summary_variants(summary)
    primary_variant = ordered_variants[0] if ordered_variants else ""
    comparison_variant = ordered_variants[1] if len(ordered_variants) > 1 else None
    duplicate_items = _format_item_numbers(summary["duplicate_item_numbers"])
    identical_items = _format_item_numbers(summary["identical_item_numbers"])
    primary_wins = int(summary["wins"].get(primary_variant, 0))
    comparison_wins = int(summary["wins"].get(comparison_variant, 0)) if comparison_variant is not None else 0
    ties = int(summary["ties"])
    primary_nonidentical = int(summary["nonidentical_wins"].get(primary_variant, 0))
    comparison_nonidentical = (
        int(summary["nonidentical_wins"].get(comparison_variant, 0)) if comparison_variant is not None else 0
    )
    nonidentical_ties = int(summary["nonidentical_ties"])

    if comparison_variant is None:
        interpretation = f"Only one variant was present in this run: <code>{html.escape(primary_variant)}</code>."
    elif primary_wins > comparison_wins:
        interpretation = (
            f"On this run, <code>{html.escape(primary_variant)}</code> led overall. "
            f"It won {primary_wins} unique items versus {comparison_wins} for <code>{html.escape(comparison_variant)}</code>."
        )
    elif comparison_wins > primary_wins:
        interpretation = (
            f"On this run, <code>{html.escape(comparison_variant)}</code> led overall. "
            f"It won {comparison_wins} unique items versus {primary_wins} for <code>{html.escape(primary_variant)}</code>."
        )
    else:
        interpretation = (
            f"On this run, <code>{html.escape(primary_variant)}</code> and <code>{html.escape(comparison_variant)}</code> "
            "finished level on unique-item wins."
        )

    prompt_sections = []
    for variant_name in ordered_variants:
        prompt_sections.append(
            "<div class=\"prompt\">"
            f"<p><code>{html.escape(variant_name)}</code></p>"
            f"<pre>{html.escape(_variant_spec(variant_name).system_prompt)}</pre>"
            f"<p><code>decode={html.escape(json.dumps(asdict(_variant_spec(variant_name)), ensure_ascii=True))}</code></p>"
            f"<p><code>A={html.escape(variant_name)}</code> on items {_format_item_numbers(summary['a_assignments'].get(variant_name, []))}.</p>"
            f"<p><code>B={html.escape(variant_name)}</code> on items {_format_item_numbers(summary['b_assignments'].get(variant_name, []))}.</p>"
            "</div>"
        )

    table_rows = "\n".join(
        (
            "<tr>"
            f"<td>{item['item_number']}</td>"
            f"<td>{item['line_number']}</td>"
            f"<td><code>{html.escape(str(item['variant_a']))}</code></td>"
            f"<td><code>{html.escape(str(item['variant_b']))}</code></td>"
            f"<td><code>{html.escape(str(item['winner_variant']))}</code></td>"
            f"<td>{'yes' if item['identical_outputs'] else 'no'}</td>"
            "</tr>"
        )
        for item in summary["items"]
    )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Translation Judge Summary</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f2ea;
      --panel: #fffdf8;
      --ink: #1e1b18;
      --muted: #73675c;
      --line: #d9cfc2;
      --accent: #a94124;
      --accent-soft: #f7dfd2;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, #efe0cf 0, transparent 30%),
        radial-gradient(circle at top right, #ece6d8 0, transparent 25%),
        var(--bg);
      color: var(--ink);
    }}
    .shell {{
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 20px;
      box-shadow: 0 12px 24px rgba(41, 31, 21, 0.05);
      margin-bottom: 18px;
    }}
    h1 {{
      margin: 0 0 10px;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1;
      letter-spacing: -0.03em;
    }}
    h2 {{
      margin: 0 0 10px;
      font-size: 1.2rem;
    }}
    p {{
      margin: 0 0 12px;
      line-height: 1.55;
    }}
    code {{
      font-size: 0.95em;
    }}
    .prompt {{
      margin: 0 0 12px;
    }}
    pre {{
      white-space: pre-wrap;
      word-break: break-word;
      margin: 0;
      line-height: 1.5;
      font-size: 0.95rem;
      font-family: inherit;
    }}
    .button {{
      display: inline-block;
      border: 1px solid var(--accent);
      background: var(--accent-soft);
      color: var(--ink);
      border-radius: 999px;
      padding: 12px 16px;
      text-decoration: none;
      font: inherit;
    }}
    .meta {{
      color: var(--muted);
    }}
    .actions {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 12px;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      font-size: 0.95rem;
    }}
    th, td {{
      text-align: left;
      padding: 10px 8px;
      border-top: 1px solid var(--line);
      vertical-align: top;
    }}
    th {{
      border-top: 0;
    }}
    @media (max-width: 900px) {{
      table, thead, tbody, th, td, tr {{
        display: block;
      }}
      th {{
        padding-bottom: 0;
      }}
      td {{
        border-top: 0;
        padding-top: 2px;
      }}
      tr {{
        border-top: 1px solid var(--line);
        padding: 8px 0;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <h1>Run Summary</h1>
    <p class="meta">Results file: {html.escape(str(service.results_path))}</p>

    <section class="card">
      <h2>What A and B meant</h2>
      <p><code>A</code> and <code>B</code> were not fixed labels. For each item, the app shuffled the two prompt variants, so you judged blind.</p>
      {''.join(prompt_sections)}
    </section>

    <section class="card">
      <h2>Result</h2>
      <p>{interpretation}</p>
      <p>Across unique items, <code>{html.escape(primary_variant)}</code> won {primary_wins}, <code>{html.escape(comparison_variant) if comparison_variant is not None else ''}</code> won {comparison_wins}, and there were {ties} ties.</p>
      <p>On items where the outputs actually differed, <code>{html.escape(primary_variant)}</code> won {primary_nonidentical}, <code>{html.escape(comparison_variant) if comparison_variant is not None else ''}</code> won {comparison_nonidentical}, and there were {nonidentical_ties} ties.</p>
      <p>The log file contains {summary['rows_logged']} rows for {summary['unique_items']} unique items. Duplicate rows were collapsed by keeping the last vote per item. Duplicate item numbers: {duplicate_items}.</p>
      <p>Items with identical A/B output: {identical_items}.</p>
    </section>

    <section class="card">
      <h2>Per Item</h2>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Line</th>
            <th>A</th>
            <th>B</th>
            <th>Winner</th>
            <th>Identical</th>
          </tr>
        </thead>
        <tbody>
          {table_rows}
        </tbody>
      </table>
    </section>

    <div class="actions">
      <a class="button" href="/summary.txt">Download Text Summary</a>
      <a class="button" href="/">Back To Start</a>
    </div>
  </div>
</body>
</html>"""


def _format_item_numbers(items: list[int]) -> str:
    if not items:
        return "none"
    return ", ".join(str(item) for item in items)
