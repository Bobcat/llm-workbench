from __future__ import annotations

import html
import re
from pathlib import Path
from threading import Lock

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import HTMLResponse

from app.core import TranslationCore
from app.events import ReplayEvent
from app.events import load_pc_events
from app.replay import ReplayRunner
from app.replay import ReplayTrace
from app.replay_settings import load_replay_settings
from app.translators import build_translator


SPEED_PRESETS = {
    "slow": 900,
    "normal": 500,
    "fast": 200,
}


class ReplayWebService:
    def __init__(
        self,
        *,
        path: str | Path,
        translator_name: str,
        dummy_mode: str,
        max_events: int | None,
    ) -> None:
        self.path = Path(path)
        self.translator_name = translator_name
        self.dummy_mode = dummy_mode
        self.settings = load_replay_settings()
        self.events = load_pc_events(self.path)
        if max_events is not None:
            self.events = self.events[:max_events]
        translator = build_translator(translator_name, dummy_mode=dummy_mode)
        self.runner = ReplayRunner(
            core=TranslationCore(
                translator=translator,
                preview_settings=self.settings.preview_translation,
                context_committed_chunks=self.settings.context_committed_chunks,
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
    service = ReplayWebService(
        path=path,
        translator_name=translator_name,
        dummy_mode=dummy_mode,
        max_events=max_events,
    )
    app = FastAPI(title="Replay Viewer")

    @app.get("/", response_class=HTMLResponse)
    def index(event: int = 1, autoplay: int = 0, speed: str = "normal") -> HTMLResponse:
        if service.total_events() == 0:
            return HTMLResponse("<h1>No events found.</h1>", status_code=200)
        safe_speed = _normalize_speed(speed)
        try:
            trace = service.get_trace(event)
        except IndexError as exc:
            raise HTTPException(status_code=404, detail="event not found") from exc
        recent_traces = service.recent_traces(event)
        return HTMLResponse(
            _render_page(
                service,
                trace,
                recent_traces,
                autoplay=bool(autoplay),
                speed=safe_speed,
            ),
            status_code=200,
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


def _playback_href(*, event: int, autoplay: bool, speed: str) -> str:
    return f"/?event={event}&autoplay={1 if autoplay else 0}&speed={speed}"


def _render_page(
    service: ReplayWebService,
    trace: ReplayTrace,
    recent_traces: list[ReplayTrace],
    *,
    autoplay: bool,
    speed: str,
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
    recent_rows = "\n".join(_render_trace_row(item, current_index=trace.event_index) for item in recent_traces)
    autoplay_js = _render_autoplay_script(next_event=next_event, autoplay=autoplay, speed=speed)
    page_restore_js = _render_scroll_restore_script()
    source_label = html.escape(service.path.as_posix())
    export_name = html.escape(_build_export_filename(service.path.stem, trace.event_index))
    llm_dir = html.escape("/home/gunnar/models/EuroLLM-9B-Instruct-ct2-int8")
    preview_settings = service.settings.preview_translation
    params_label = (
        "sentence_gate=source; "
        f"context_chunks={service.settings.context_committed_chunks}; "
        f"preview=min_chars={preview_settings.min_chars}, "
        f"ratio<={preview_settings.max_distance_ratio:.2f}, "
        f"growth>={preview_settings.min_growth_chars}"
    )

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
        <a class="primary" href="{_playback_href(event=trace.event_index, autoplay=True, speed=speed)}">Play</a>
        <a href="{_playback_href(event=trace.event_index, autoplay=False, speed=speed)}">Pause</a>
        <a href="{_playback_href(event=1, autoplay=False, speed=speed)}">Restart</a>
        <a href="{_playback_href(event=next_event or trace.event_index, autoplay=False, speed=speed)}">Step</a>
        <button class="primary" type="button" onclick="downloadReplaySnapshot()">Export text file</button>
        <div class="speed-group">
          <a class="{ 'active' if speed == 'slow' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='slow')}">Slow</a>
          <a class="{ 'active' if speed == 'normal' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='normal')}">Normal</a>
          <a class="{ 'active' if speed == 'fast' else '' }" href="{_playback_href(event=trace.event_index, autoplay=autoplay, speed='fast')}">Fast</a>
        </div>
      </div>
      <div class="status">
        Replay is <strong>{'running' if autoplay else 'paused'}</strong>.
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
      <div class="card"><div class="label">Latency</div><div class="value">{trace.decision.latency_ms:.1f} ms</div></div>
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


def _render_trace_row(trace: ReplayTrace, *, current_index: int) -> str:
    row_class = ' class="current"' if trace.event_index == current_index else ""
    translated = "yes" if trace.decision.triggered else "no"
    translated_class = "yes" if trace.decision.triggered else "no"
    text = trace.event.text[:80] + ("..." if len(trace.event.text) > 80 else "")
    if not text:
        text = "(empty)"
    return (
        f"<tr{row_class}>"
        f"<td><a href='/?event={trace.event_index}&autoplay=0&speed=normal'>{trace.event_index}</a></td>"
        f"<td><code>{html.escape(trace.event.kind)}</code></td>"
        f"<td class='{translated_class}'>{translated}</td>"
        f"<td>{trace.decision.latency_ms:.1f} ms</td>"
        f"<td><code>{html.escape(text)}</code></td>"
        "</tr>"
    )


def _build_export_filename(sample_stem: str, event_index: int) -> str:
    safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", sample_stem).strip("._-")
    if not safe_stem:
        safe_stem = "replay"
    return f"{safe_stem}_event_{event_index:04d}.txt"


def _render_autoplay_script(*, next_event: int | None, autoplay: bool, speed: str) -> str:
    if not autoplay or next_event is None:
        return ""
    delay_ms = SPEED_PRESETS[_normalize_speed(speed)]
    return (
        "<script>\n"
        "window.history.scrollRestoration = 'manual';\n"
        f"window.setTimeout(function () {{ window.location.href = '/?event={next_event}&autoplay=1&speed={speed}'; }}, {delay_ms});\n"
        "</script>"
    )


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
