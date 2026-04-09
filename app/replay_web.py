from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from datetime import timezone
import html
import json
import re
from pathlib import Path
import statistics
from threading import Lock
from urllib import error
from urllib.parse import quote
from urllib import request

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import HTMLResponse
from fastapi.responses import PlainTextResponse

from app.core import TranslationCore
from app.events import ReplayEvent
from app.events import load_pc_events
from app.replay import ReplayRunner
from app.replay import ReplayTrace
from app.replay_settings import load_replay_settings
from app.translators import build_translator
from app.translators import DEFAULT_LLM_RESPONSES_API_BASE_URL


SPEED_PRESETS = {
    "slow": 900,
    "normal": 500,
    "fast": 200,
}
MODEL_DISCOVERY_TIMEOUT_SECONDS = 2.0


class ReplayWebService:
    def __init__(
        self,
        *,
        path: str | Path,
        translator_name: str,
        dummy_mode: str,
        max_events: int | None,
        service_model: str | None = None,
    ) -> None:
        self.path = Path(path)
        self.translator_name = translator_name
        self.dummy_mode = dummy_mode
        self.service_model = service_model
        self.settings = load_replay_settings()
        self.events = load_pc_events(self.path)
        if max_events is not None:
            self.events = self.events[:max_events]
        self.run_timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        export_stem = self.path.stem
        if service_model:
            export_stem = f"{export_stem}_{_safe_slug(service_model)}"
        self.final_export_path = Path("tmp") / _build_export_filename(
            export_stem,
            None,
            timestamp=self.run_timestamp,
            artifact="final",
            extension=".txt",
        )
        self.metrics_summary_path = Path("tmp") / _build_export_filename(
            export_stem,
            None,
            timestamp=self.run_timestamp,
            artifact="metrics_summary",
            extension=".json",
        )
        self.trace_export_path = Path("tmp") / _build_export_filename(
            export_stem,
            None,
            timestamp=self.run_timestamp,
            artifact="trace",
            extension=".jsonl",
        )
        translator = build_translator(
            translator_name,
            dummy_mode=dummy_mode,
            service_model=service_model,
            correction_model=self.settings.commit_correction.model,
            first_pass_prompt=self.settings.first_pass.prompt,
            first_pass_input_template=self.settings.first_pass.input_template,
            correction_input_template=self.settings.commit_correction.input_template,
        )
        self.runner = ReplayRunner(
            core=TranslationCore(
                translator=translator,
                preview_settings=self.settings.preview_translation,
                commit_correction_enabled=self.settings.commit_correction.enabled,
                commit_correction_prompt=self.settings.commit_correction.prompt,
            )
        )
        self._traces: list[ReplayTrace] = []
        self._lock = Lock()

    def total_events(self) -> int:
        return len(self.events)

    def get_trace(self, event_index: int) -> ReplayTrace:
        if event_index < 1 or event_index > self.total_events():
            raise IndexError(event_index)
        self._ensure_trace(event_index)
        return self._traces[event_index - 1]

    def recent_traces(self, event_index: int, *, radius: int = 5) -> list[ReplayTrace]:
        self._ensure_trace(event_index)
        start = max(0, event_index - radius - 1)
        end = min(len(self._traces), event_index + radius)
        return self._traces[start:end]

    def write_final_snapshot(self) -> Path:
        if self.total_events() == 0:
            raise IndexError("no events")
        final_trace = self.get_trace(self.total_events())
        metrics_summary = _build_metrics_summary(service=self, traces=self._traces)
        content = _build_snapshot_text(
            source_text=_visible_state_text(
                committed=final_trace.source_state.source_committed_text,
                preview=final_trace.source_state.source_preview_text,
            ),
            target_text=_visible_state_text(
                committed=final_trace.target_state.target_committed_text,
                preview=final_trace.target_state.target_preview_text,
            ),
            metrics_summary=metrics_summary,
        )
        self.final_export_path.parent.mkdir(parents=True, exist_ok=True)
        self.final_export_path.write_text(content, encoding="utf-8")
        self.metrics_summary_path.write_text(
            json.dumps(metrics_summary, ensure_ascii=True, indent=2) + "\n",
            encoding="utf-8",
        )
        self.trace_export_path.write_text(
            "".join(json.dumps(_build_trace_record(trace), ensure_ascii=True) + "\n" for trace in self._traces if trace.decision.triggered),
            encoding="utf-8",
        )
        return self.final_export_path

    def _ensure_trace(self, event_index: int) -> None:
        with self._lock:
            while len(self._traces) < event_index:
                next_index = len(self._traces) + 1
                event = self.events[next_index - 1]
                self._traces.append(self.runner.process_event(next_index, event))


def create_replay_app(
    *,
    path: str | Path,
    translator_name: str = "dummy",
    dummy_mode: str = "marker",
    max_events: int | None = None,
) -> FastAPI:
    available_models = _load_service_models() if translator_name == "ct2-eurollm" else []
    service_cache: dict[str, ReplayWebService] = {}
    service_cache_lock = Lock()

    def resolve_model(model: str | None) -> str | None:
        if not available_models:
            return None
        candidate = str(model or "").strip()
        if candidate in available_models:
            return candidate
        return available_models[0]

    def get_service(model: str | None) -> ReplayWebService:
        key = model or "__default__"
        with service_cache_lock:
            existing = service_cache.get(key)
            if existing is not None:
                return existing
            created = ReplayWebService(
                path=path,
                translator_name=translator_name,
                dummy_mode=dummy_mode,
                max_events=max_events,
                service_model=model,
            )
            service_cache[key] = created
            return created

    app = FastAPI(title="Replay Viewer")

    @app.get("/", response_class=HTMLResponse)
    def index(event: int = 1, autoplay: int = 0, speed: str = "normal", model: str | None = None) -> HTMLResponse:
        selected_model = resolve_model(model)
        service = get_service(selected_model)
        if service.total_events() == 0:
            return HTMLResponse("<h1>No events found.</h1>", status_code=200)
        safe_speed = _normalize_speed(speed)
        try:
            trace = service.get_trace(event)
        except IndexError as exc:
            raise HTTPException(status_code=404, detail="event not found") from exc
        if event == service.total_events():
            service.write_final_snapshot()
        recent_traces = service.recent_traces(event)
        return HTMLResponse(
            _render_page(
                service,
                trace,
                recent_traces,
                autoplay=bool(autoplay),
                speed=safe_speed,
                selected_model=selected_model,
                available_models=available_models,
            ),
            status_code=200,
        )

    @app.get("/export/final.txt", response_class=PlainTextResponse)
    def export_final(model: str | None = None) -> PlainTextResponse:
        selected_model = resolve_model(model)
        service = get_service(selected_model)
        if service.total_events() == 0:
            raise HTTPException(status_code=404, detail="no events found")
        path = service.write_final_snapshot()
        return PlainTextResponse(
            path.read_text(encoding="utf-8"),
            headers={"Content-Disposition": f'inline; filename="{path.name}"'},
        )

    return app


def _normalize_speed(speed: str) -> str:
    value = str(speed or "").strip().lower()
    if value in SPEED_PRESETS:
        return value
    return "normal"


def _render_state_html(*, committed: str, preview: str, empty_text: str) -> str:
    if not committed and not preview:
        return f'<span class="placeholder">{html.escape(empty_text)}</span>'

    parts: list[str] = []
    if committed:
        parts.append(f'<span class="committed-fragment">{html.escape(committed)}</span>')
    if committed and preview and not committed.endswith((" ", "\n")) and not preview.startswith((" ", "\n")):
        parts.append(" ")
    if preview:
        parts.append(f'<span class="preview-fragment">{html.escape(preview)}</span>')
    return "".join(parts)


def _visible_state_text(*, committed: str, preview: str) -> str:
    if not committed or not preview:
        return f"{committed}{preview}"
    if committed.endswith((" ", "\n")) or preview.startswith((" ", "\n")):
        return f"{committed}{preview}"
    return f"{committed} {preview}"


def _build_snapshot_text(*, source_text: str, target_text: str, metrics_summary: dict[str, object]) -> str:
    summary_lines = _build_metrics_summary_lines(metrics_summary)
    return "\n".join(
        [
            "Metrics",
            *summary_lines,
            "",
            "Source",
            source_text,
            "",
            "Target",
            target_text,
            "",
        ]
    )


def _playback_href(*, event: int, autoplay: bool, speed: str, model: str | None = None) -> str:
    href = f"/?event={event}&autoplay={1 if autoplay else 0}&speed={speed}"
    if model:
        href += f"&model={quote(model, safe='')}"
    return href


def _render_page(
    service: ReplayWebService,
    trace: ReplayTrace,
    recent_traces: list[ReplayTrace],
    *,
    autoplay: bool,
    speed: str,
    selected_model: str | None,
    available_models: list[str],
) -> str:
    prev_event = trace.event_index - 1 if trace.event_index > 1 else None
    next_event = trace.event_index + 1 if trace.event_index < service.total_events() else None
    current_source_html = _render_state_html(
        committed=trace.source_state.source_committed_text,
        preview=trace.source_state.source_preview_text,
        empty_text="(empty)",
    )
    current_target_html = _render_state_html(
        committed=trace.target_state.target_committed_text,
        preview=trace.target_state.target_preview_text,
        empty_text="(waiting for translation)",
    )
    speed_ms = SPEED_PRESETS[speed]
    recent_rows = "\n".join(
        _render_trace_row(
            item,
            current_index=trace.event_index,
            speed=speed,
            model=selected_model,
        )
        for item in recent_traces
    )
    autoplay_js = _render_autoplay_script(
        next_event=next_event,
        autoplay=autoplay,
        speed=speed,
        model=selected_model,
    )
    page_restore_js = _render_scroll_restore_script()
    source_label = html.escape(service.path.as_posix())
    export_name = html.escape(_build_export_filename(service.path.stem, trace.event_index))
    final_export_href = "/export/final.txt"
    if selected_model:
        final_export_href += f"?model={quote(selected_model, safe='')}"
    llm_dir = html.escape("/home/gunnar/models/EuroLLM-9B-Instruct-ct2-int8")
    preview_settings = service.settings.preview_translation
    params_label = (
        "sentence_gate=source; "
        f"preview=min_chars={preview_settings.min_chars}, "
        f"ratio<={preview_settings.max_distance_ratio:.2f}, "
        f"growth>={preview_settings.min_growth_chars}"
    )
    model_controls_html = _render_model_controls(
        selected_model=selected_model,
        available_models=available_models,
        speed=speed,
    )
    selected_model_label = html.escape(selected_model or "(default)")

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Replay Viewer</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f6f1e8;
      --panel: #fffdf9;
      --panel-strong: #faf4ea;
      --ink: #1f1b17;
      --muted: #72675d;
      --line: #d8cfc3;
      --accent: #135f74;
      --accent-soft: #dbeff5;
      --good: #29663b;
      --warn: #9a4c20;
      --active: #efe5d5;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: var(--ink);
      font-family: Georgia, "Times New Roman", serif;
      background:
        radial-gradient(circle at top left, #efdfca 0, transparent 28%),
        radial-gradient(circle at top right, #dae9f0 0, transparent 24%),
        linear-gradient(180deg, #faf7f1 0%, var(--bg) 100%);
    }}
    .shell {{
      max-width: 1280px;
      margin: 0 auto;
      padding: 28px 18px 40px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: clamp(2.1rem, 4vw, 3.5rem);
      line-height: 0.95;
      letter-spacing: -0.04em;
    }}
    .lead {{
      color: var(--muted);
      margin-bottom: 20px;
      display: grid;
      gap: 4px;
    }}
    .lead .line {{
      display: block;
    }}
    .lead code {{
      font-size: 0.96em;
    }}
    .stage {{
      margin-bottom: 18px;
      background: linear-gradient(135deg, #fff8ef 0%, #edf7fb 100%);
      border: 1px solid var(--line);
      border-radius: 22px;
      padding: 18px;
      box-shadow: 0 12px 28px rgba(33, 25, 19, 0.06);
    }}
    .controls {{
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
      margin-bottom: 14px;
    }}
    .controls a {{
      text-decoration: none;
      color: var(--ink);
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
    }}
    .controls button {{
      text-decoration: none;
      color: var(--ink);
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 999px;
      padding: 10px 14px;
      font: inherit;
      cursor: pointer;
    }}
    .controls a.primary {{
      border-color: var(--accent);
      background: var(--accent-soft);
    }}
    .controls button.primary {{
      border-color: var(--accent);
      background: var(--accent-soft);
    }}
    .model-form {{
      display: inline-flex;
      gap: 8px;
      align-items: center;
      margin-left: 6px;
    }}
    .model-form label {{
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .model-form select {{
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 9px 12px;
      background: var(--panel);
      font: inherit;
      color: var(--ink);
    }}
    .speed-group {{
      display: inline-flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-left: auto;
    }}
    .speed-group a.active {{
      background: var(--active);
      border-color: var(--accent);
    }}
    .status {{
      color: var(--muted);
      margin-bottom: 14px;
    }}
    .stage-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }}
    .stage-column {{
      display: grid;
      gap: 8px;
    }}
    .stage-panel,
    .panel,
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 10px 24px rgba(34, 26, 20, 0.05);
    }}
    .stage-panel {{
      padding: 16px;
      min-height: 240px;
    }}
    .column-label,
    .card .label,
    th {{
      color: var(--muted);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    pre {{
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.55;
      font-family: inherit;
      font-size: 1rem;
    }}
    .placeholder {{
      color: var(--muted);
      font-style: italic;
    }}
    .preview-fragment {{
      color: var(--muted);
      font-style: italic;
    }}
    .stats {{
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }}
    .card {{
      padding: 14px 16px;
    }}
    .card .value {{
      font-size: 1.15rem;
      font-weight: 700;
    }}
    .debug {{
      margin-top: 18px;
    }}
    details.panel {{
      padding: 0;
      overflow: hidden;
    }}
    details.panel summary {{
      cursor: pointer;
      list-style: none;
      padding: 16px 18px;
      font-weight: 700;
      background: var(--panel);
    }}
    details.panel summary::-webkit-details-marker {{
      display: none;
    }}
    .debug-body {{
      padding: 0 18px 18px;
      display: grid;
      gap: 14px;
    }}
    .debug-grid {{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }}
    .mini {{
      background: var(--panel-strong);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px 14px;
    }}
    .mini strong {{
      display: block;
      margin-bottom: 6px;
      font-size: 0.88rem;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
    }}
    th, td {{
      text-align: left;
      padding: 10px 8px;
      border-top: 1px solid var(--line);
      vertical-align: top;
    }}
    .current {{
      background: #f9f2e3;
    }}
    .yes {{
      color: var(--good);
      font-weight: 700;
    }}
    .no {{
      color: var(--warn);
      font-weight: 700;
    }}
    code {{
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      font-size: 0.92em;
    }}
    @media (max-width: 980px) {{
      .stage-grid,
      .stats,
      .debug-grid {{
        grid-template-columns: 1fr;
      }}
      .speed-group {{
        margin-left: 0;
      }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <h1>Replay Viewer</h1>
    <div class="lead">
      <span class="line">Sample file: <code>{source_label}</code></span>
      <span class="line">LLM dir: <code>{llm_dir}</code></span>
      <span class="line">Params: <code>{html.escape(params_label)}</code></span>
    </div>

    <div class="stage">
      <div class="controls">
        <a class="primary" href="{_playback_href(event=trace.event_index, autoplay=True, speed=speed, model=selected_model)}">Play</a>
        <a href="{_playback_href(event=trace.event_index, autoplay=False, speed=speed, model=selected_model)}">Pause</a>
        <a href="{_playback_href(event=1, autoplay=False, speed=speed, model=selected_model)}">Restart</a>
        <a href="{_playback_href(event=next_event or trace.event_index, autoplay=False, speed=speed, model=selected_model)}">Step</a>
        <button class="primary" type="button" onclick="downloadReplaySnapshot()">Export text file</button>
        <a href="{final_export_href}">Export final server file</a>
        {model_controls_html}
        <div class="speed-group">
          <a class="{ 'active' if speed == 'slow' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='slow', model=selected_model)}">Slow</a>
          <a class="{ 'active' if speed == 'normal' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='normal', model=selected_model)}">Normal</a>
          <a class="{ 'active' if speed == 'fast' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='fast', model=selected_model)}">Fast</a>
        </div>
      </div>
      <div class="status">
        Replay is <strong>{'running' if autoplay else 'paused'}</strong>.
        Model: <code>{selected_model_label}</code>.
        Speed: <code>{speed}</code> ({speed_ms} ms per event).
        Event <code>{trace.event_index}</code> of <code>{service.total_events()}</code>.
      </div>
      <div class="stage-grid">
        <div class="stage-column">
          <div class="column-label">Source</div>
          <div class="stage-panel">
            <pre id="current-source-text">{current_source_html}</pre>
          </div>
        </div>
        <div class="stage-column">
          <div class="column-label">Target</div>
          <div class="stage-panel">
            <pre id="current-target-text">{current_target_html}</pre>
          </div>
        </div>
      </div>
    </div>

    <div class="stats">
      <div class="card"><div class="label">Event</div><div class="value">{trace.event_index} / {service.total_events()}</div></div>
      <div class="card"><div class="label">Line</div><div class="value">{trace.event.line_number}</div></div>
      <div class="card"><div class="label">Kind</div><div class="value"><code>{html.escape(trace.event.kind)}</code></div></div>
      <div class="card"><div class="label">Translated</div><div class="value {'yes' if trace.decision.triggered else 'no'}">{'yes' if trace.decision.triggered else 'no'}</div></div>
      <div class="card"><div class="label">Replay Wall</div><div class="value">{_decision_replay_request_wall_ms(trace):.1f} ms</div></div>
    </div>

    <div class="debug">
      <details class="panel">
        <summary>Debug Details</summary>
        <div class="debug-body">
          <div class="debug-grid">
            <div class="mini">
              <strong>Current Event Text</strong>
              <pre>{html.escape(_event_text(trace.event))}</pre>
            </div>
            <div class="mini">
              <strong>Source Window</strong>
              <pre>{html.escape(trace.decision.source_window or '(not translated on this event)')}</pre>
            </div>
            <div class="mini">
              <strong>Committed Source Raw</strong>
              <pre>{html.escape(trace.source_state.source_committed_text or '(empty)')}</pre>
            </div>
            <div class="mini">
              <strong>Preview Raw</strong>
              <pre>{html.escape(trace.source_state.source_preview_text or '(empty)')}</pre>
            </div>
            <div class="mini">
              <strong>Target Committed Raw</strong>
              <pre>{html.escape(trace.target_state.target_committed_text or '(empty)')}</pre>
            </div>
            <div class="mini">
              <strong>Target Preview Raw</strong>
              <pre>{html.escape(trace.target_state.target_preview_text or '(empty)')}</pre>
            </div>
          </div>
          <div class="mini">
            <strong>Nearby Events</strong>
            <table>
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Kind</th>
                  <th>Translated</th>
                  <th>Latency</th>
                  <th>Text</th>
                </tr>
              </thead>
              <tbody>
                {recent_rows}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  </div>
  {autoplay_js}
  {_render_export_script(export_name=export_name)}
  {page_restore_js}
</body>
</html>"""


def _event_text(event: ReplayEvent) -> str:
    if event.text == "":
        return "(empty)"
    return str(event.text)


def _render_trace_row(trace: ReplayTrace, *, current_index: int, speed: str, model: str | None) -> str:
    row_class = ' class="current"' if trace.event_index == current_index else ""
    translated = "yes" if trace.decision.triggered else "no"
    translated_class = "yes" if trace.decision.triggered else "no"
    text = trace.event.text[:80] + ("..." if len(trace.event.text) > 80 else "")
    if not text:
        text = "(empty)"
    return (
        f"<tr{row_class}>"
        f"<td><a href='{_playback_href(event=trace.event_index, autoplay=False, speed=speed, model=model)}'>{trace.event_index}</a></td>"
        f"<td><code>{html.escape(trace.event.kind)}</code></td>"
        f"<td class='{translated_class}'>{translated}</td>"
        f"<td>{_decision_replay_request_wall_ms(trace):.1f} ms</td>"
        f"<td><code>{html.escape(text)}</code></td>"
        "</tr>"
    )


def _build_metrics_summary(*, service: ReplayWebService, traces: list[ReplayTrace]) -> dict[str, object]:
    translated_traces = [trace for trace in traces if trace.decision.triggered]
    preview_translations = sum(1 for trace in translated_traces if trace.event.kind == "p")
    commit_translations = sum(1 for trace in translated_traces if trace.event.kind == "c")
    return {
        "sample_file": service.path.as_posix(),
        "model": service.service_model or "",
        "events_total": service.total_events(),
        "translations_total": len(translated_traces),
        "preview_translations": preview_translations,
        "commit_translations": commit_translations,
        "metrics": {
            "replay_request_wall_ms": _summarize_metric(_metric_values(translated_traces, "replay_request_wall_ms")),
            "observed_first_text_ms": _summarize_metric(_metric_values(translated_traces, "observed_first_text_ms")),
            "observed_complete_ms": _summarize_metric(_metric_values(translated_traces, "observed_complete_ms")),
            "transport_first_byte_ms": _summarize_metric(_metric_values(translated_traces, "transport_first_byte_ms")),
            "transport_first_text_delta_ms": _summarize_metric(_metric_values(translated_traces, "transport_first_text_delta_ms")),
            "transport_completed_ms": _summarize_metric(_metric_values(translated_traces, "transport_completed_ms")),
            "engine_tokenize_ms": _summarize_metric(_metric_values(translated_traces, "engine_tokenize_ms")),
            "gpu_time_to_first_token_ms": _summarize_metric(_metric_values(translated_traces, "gpu_time_to_first_token_ms")),
            "gpu_generate_total_ms": _summarize_metric(_metric_values(translated_traces, "gpu_generate_total_ms")),
            "gpu_decode_after_first_token_ms": _summarize_metric(_metric_values(translated_traces, "gpu_decode_after_first_token_ms")),
            "engine_tokens_per_second": _summarize_metric(_metric_values(translated_traces, "engine_tokens_per_second")),
        },
    }


def _build_metrics_summary_lines(metrics_summary: dict[str, object]) -> list[str]:
    metrics_payload = metrics_summary.get("metrics", {})
    if not isinstance(metrics_payload, dict):
        metrics_payload = {}
    lines = [
        f"Sample file: {metrics_summary.get('sample_file', '')}",
        f"Model: {metrics_summary.get('model', '') or '(default)'}",
        f"Events total: {metrics_summary.get('events_total', 0)}",
        f"Translations total: {metrics_summary.get('translations_total', 0)}",
        f"Preview translations: {metrics_summary.get('preview_translations', 0)}",
        f"Commit translations: {metrics_summary.get('commit_translations', 0)}",
    ]
    for metric_name in (
        "replay_request_wall_ms",
        "observed_first_text_ms",
        "observed_complete_ms",
        "transport_completed_ms",
        "gpu_time_to_first_token_ms",
        "gpu_generate_total_ms",
        "engine_tokens_per_second",
    ):
        summary = metrics_payload.get(metric_name)
        if not isinstance(summary, dict) or not summary:
            continue
        avg_value = summary.get("avg")
        p50_value = summary.get("p50")
        p95_value = summary.get("p95")
        if avg_value is None or p50_value is None or p95_value is None:
            continue
        lines.append(
            f"{metric_name}: avg={avg_value:.1f} p50={p50_value:.1f} p95={p95_value:.1f}"
        )
    return lines


def _build_trace_record(trace: ReplayTrace) -> dict[str, object]:
    return {
        "event_index": trace.event_index,
        "line_number": trace.event.line_number,
        "event_kind": trace.event.kind,
        "event_text": trace.event.text,
        "reason": trace.decision.reason,
        "triggered": trace.decision.triggered,
        "request_id": trace.decision.request_id,
        "model": trace.decision.model,
        "source_window": trace.decision.source_window,
        "source_chunks_used": trace.decision.source_chunks_used,
        "target_preview_text": trace.decision.target_preview_text,
        "metrics": asdict(trace.decision.metrics),
    }


def _metric_values(traces: list[ReplayTrace], name: str) -> list[float]:
    values: list[float] = []
    for trace in traces:
        value = getattr(trace.decision.metrics, name)
        if value is not None:
            values.append(float(value))
    return values


def _summarize_metric(values: list[float]) -> dict[str, float | int] | None:
    if not values:
        return None
    ordered = sorted(values)
    return {
        "count": len(ordered),
        "avg": statistics.fmean(ordered),
        "p50": _percentile(ordered, 0.50),
        "p95": _percentile(ordered, 0.95),
    }


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    index = max(0, min(len(values) - 1, round((len(values) - 1) * fraction)))
    return values[index]


def _decision_replay_request_wall_ms(trace: ReplayTrace) -> float:
    return float(trace.decision.metrics.replay_request_wall_ms or 0.0)


def _build_export_filename(
    sample_stem: str,
    event_index: int | None,
    *,
    timestamp: str = "",
    artifact: str = "final",
    extension: str = ".txt",
) -> str:
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", sample_stem).strip("._-")
    if not safe_stem:
        safe_stem = "replay"
    if event_index is None:
        if timestamp:
            return f"{safe_stem}_{timestamp}_{artifact}{extension}"
        return f"{safe_stem}_{artifact}{extension}"
    return f"{safe_stem}_event_{event_index:04d}{extension}"


def _render_autoplay_script(*, next_event: int | None, autoplay: bool, speed: str, model: str | None) -> str:
    if not autoplay or next_event is None:
        return ""
    delay_ms = SPEED_PRESETS[_normalize_speed(speed)]
    href = _playback_href(event=next_event, autoplay=True, speed=speed, model=model)
    return (
        "<script>\n"
        "window.history.scrollRestoration = 'manual';\n"
        f"window.setTimeout(function () {{ window.location.href = {href!r}; }}, {delay_ms});\n"
        "</script>"
    )


def _load_service_models() -> list[str]:
    req = request.Request(
        url=f"{DEFAULT_LLM_RESPONSES_API_BASE_URL.rstrip('/')}/v1/models",
        headers={"Accept": "application/json"},
        method="GET",
    )
    payload: object
    try:
        with request.urlopen(req, timeout=MODEL_DISCOVERY_TIMEOUT_SECONDS) as response:
            payload = json.load(response)
    except (error.HTTPError, error.URLError, json.JSONDecodeError):
        return []

    if not isinstance(payload, dict):
        return []
    raw = payload.get("models", [])
    default_model = payload.get("default_model")
    if not isinstance(raw, list):
        return []

    models: list[str] = []
    for candidate in raw:
        value = str(candidate).strip()
        if value and value not in models:
            models.append(value)
    if isinstance(default_model, str):
        normalized_default = default_model.strip()
        if normalized_default in models:
            models.remove(normalized_default)
            models.insert(0, normalized_default)
    return models


def _render_model_controls(*, selected_model: str | None, available_models: list[str], speed: str) -> str:
    if not available_models:
        return ""
    options = []
    for model in available_models:
        selected = " selected" if model == selected_model else ""
        options.append(f'<option value="{html.escape(model)}"{selected}>{html.escape(model)}</option>')
    return (
        '<form class="model-form" method="get" action="/">'
        '<label for="model-select">Model</label>'
        '<input type="hidden" name="event" value="1">'
        '<input type="hidden" name="autoplay" value="0">'
        f'<input type="hidden" name="speed" value="{html.escape(speed)}">'
        f'<select id="model-select" name="model">{"".join(options)}</select>'
        '<button type="submit">Apply</button>'
        "</form>"
    )


def _safe_slug(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", str(value)).strip("._-")
    if cleaned:
        return cleaned
    return "model"


def _render_export_script(*, export_name: str) -> str:
    return (
        "<script>\n"
        "function downloadReplaySnapshot() {\n"
        "  const sourceNode = document.getElementById('current-source-text');\n"
        "  const targetNode = document.getElementById('current-target-text');\n"
        "  if (!sourceNode || !targetNode) {\n"
        "    return;\n"
        "  }\n"
        "  const sourceText = sourceNode.textContent || '';\n"
        "  const targetText = targetNode.textContent || '';\n"
        "  const content = [\n"
        "    'Source',\n"
        "    sourceText,\n"
        "    '',\n"
        "    'Target',\n"
        "    targetText,\n"
        "  ].join('\\n');\n"
        "  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });\n"
        "  const url = URL.createObjectURL(blob);\n"
        "  const link = document.createElement('a');\n"
        f"  link.download = {export_name!r};\n"
        "  link.href = url;\n"
        "  document.body.appendChild(link);\n"
        "  link.click();\n"
        "  link.remove();\n"
        "  window.setTimeout(() => URL.revokeObjectURL(url), 0);\n"
        "}\n"
        "</script>"
    )


def _render_scroll_restore_script() -> str:
    return (
        "<script>\n"
        "window.history.scrollRestoration = 'manual';\n"
        "try {\n"
        "  const raw = sessionStorage.getItem('replay-viewer-scroll');\n"
        "  if (raw) {\n"
        "    const pos = JSON.parse(raw);\n"
        "    if (Number.isFinite(pos.x) || Number.isFinite(pos.y)) {\n"
        "      window.requestAnimationFrame(() => window.scrollTo(Number(pos.x) || 0, Number(pos.y) || 0));\n"
        "    }\n"
        "  }\n"
        "} catch (err) {}\n"
        "function saveReplayScroll() {\n"
        "  try {\n"
        "    sessionStorage.setItem('replay-viewer-scroll', JSON.stringify({ x: window.scrollX || 0, y: window.scrollY || 0 }));\n"
        "  } catch (err) {}\n"
        "}\n"
        "window.addEventListener('scroll', saveReplayScroll, { passive: true });\n"
        "window.addEventListener('beforeunload', saveReplayScroll);\n"
        "</script>"
    )
