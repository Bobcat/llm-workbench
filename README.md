# Translation Replay Dev

Streaming translation workbench for replaying transcript events and inspecting translation decisions in real-time.

## Overview

This tool replays `.pc` transcript files and shows translations as they happen. It connects to an LLM service (llm-responses-api) for actual translations.

## Local Setup

This backend now depends on the sibling package repo:

- `../realtime-translation-engine`

For a fresh local environment:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -e .
./.venv/bin/python -m pip install -e ../realtime-translation-engine
```

## Workflows

### Web UI Replay

Interactive browser-based replay with real-time translation display.

**Start the server:**
```bash
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8002
```

**Open in browser:**
```
http://127.0.0.1:8002/?#replay
```

**Features:**
- Play/Pause/Reset controls with speed presets (Slow/Normal/Fast)
- Model selection from available LLMs via `/v1/models` endpoint
- Real-time source and target text display
- Per-event metrics: Event number, Kind (c/p), Translated (yes/no), Translation wall (ms)
- Export session state with performance statistics
- Mixed-model detection in exports (when model is switched mid-session)

**Replay semantics:**
- `p` events update source preview only
- `c` events append to committed source, clear preview, trigger translation
- Source chunks since last sentence boundary (`.`, `?`, `!`) form the translation window
- Preview translations trigger when preview is stable, long enough, and has grown sufficiently
- Target preview commits only at sentence boundaries

## Configuration

**`settings.json`** – Default thresholds and prompts:
- `replay.first_pass.default_model`: Default LLM for translations
- `replay.first_pass.prompt`: Translation system prompt
- `replay.preview_translation`: Preview stability thresholds (min_chars, max_distance_ratio, min_growth_chars)
- `replay.commit_correction`: Post-translation correction settings

**`local.json`** – Local overrides (gitignored). Set `replay.commit_correction.enabled: false` to disable correction pass.

## Architecture

**Core:**
- `app/events.py` – `.pc` file parser
- `app/source_state.py` – Source committed/preview state
- `app/core.py` – Translation engine with preview/commit logic
- `app/translators.py` – LLM client wrapper

**API:**
- `app/api/replay.py` – FastAPI endpoints: session, play/pause/reset, model switch, export
- `app/main.py` – FastAPI app with WebSocket for real-time updates

**Web UI:**
- `llm-workbench-web/` – SPA frontend (served via static mount in development)

## API Endpoints

- `POST /api/replay/session` – Create new session from .pc file
- `POST /api/replay/{id}/start` – Start/resume playback
- `POST /api/replay/{id}/pause` – Pause playback
- `POST /api/replay/{id}/reset` – Reset to beginning
- `POST /api/replay/{id}/model` – Switch model (preserves session state)
- `GET /api/replay/{id}/export` – Export current state with metrics
- `WS /ws/replay/{id}` – WebSocket for real-time updates

## Tests

```bash
python3 -m unittest discover -s tests
```

## Dependencies

Requires `llm-responses-api-dev` service running on `http://127.0.0.1:8011` (or as configured).
