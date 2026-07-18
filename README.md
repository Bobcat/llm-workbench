# LLM Workbench

LLM Workbench is a browser shell for local AI service consoles and workflow
playgrounds.

The app has two kinds of surfaces:

- stable consoles for local services such as `llm-pool`, `tts-pool`,
  `image-pool`, and `translation-services`
- playgrounds for designing and testing workflows before they become a service
  or a permanent console

The backend is a FastAPI app. It serves the frontend from `static/`, proxies
service APIs on the same origin, and owns temporary workbench session state.

## Index

- [Workbench Areas](#workbench-areas)
- [Repository Role](#repository-role)
- [Related Services](#related-services)
- [Code Map](#code-map)
- [Backend Contract](#backend-contract)
- [Runtime Model](#runtime-model)
- [Configuration](#configuration)
- [Development](#development)
- [Verification](#verification)
- [License](#license)

## Workbench Areas

### Permanent Service Consoles

These surfaces are expected to stay. Their UI can change.

**LLM Pool**

- `Models` lists, loads, unloads, and inspects `llm-pool` models.
- `Text generation` runs one-off prompts against loaded models.
- `Chat` runs multi-turn chat when the selected model supports it. Models
  without multi-turn support use a flattened prompt fallback.

**TTS Pool**

- `Models` lists, loads, unloads, and inspects `tts-pool` models.

**Image Pool**

- `Models` lists, loads, unloads, and inspects `image-pool` models.
- `Image generation` runs image generation and image edit requests.
- `Train` manages image datasets, captions images, configures LoRA training,
  starts training runs, and monitors progress.

**Translation Services**

- `Image translation` submits image translation requests and inspects artifacts.
- `PDF translation` submits PDF translation requests and previews the translated document.
- `PDF testing` shows the PDF benchmark comparison matrix and imports external translations for scoring.
- `Prompt Library` manages prompts used by translation services.
- `Regression testing` captures and re-runs image translation fixtures.

The same pattern can host later service consoles. One likely example is TTS
Services for shared voice libraries and stable generated voices.

### Playground And Incubation

These surfaces are useful, but may move or be extracted.

- `Realtime Translation / Replay & Translate` replays `.pc` transcript streams
  and inspects translation behavior.
- `Realtime TTS / Replay & Speak` replays committed transcript segments through
  `tts-pool`.

### Developer And Design Helpers

- `Icons / Colors` is an internal helper for comparing icon and color options.

## Repository Role

This repo owns:

- the FastAPI workbench app
- the same-origin frontend shell
- service proxy routes for local AI services
- workflow UI modules under `static/src/workflows/`
- replay session orchestration for current playgrounds
- prompt-library storage used by the realtime translation playground
- workbench-side image training dataset management

This repo does not own:

- LLM inference or model lifecycle internals; `llm-pool` owns those
- image model inference and training execution; `image-pool` owns those
- TTS model inference; `tts-pool` owns that
- image translation execution; `translation-services` owns that
- reusable realtime translation engine behavior; `realtime-translation-engine`
  owns that

## Related Services

- [llm-pool](https://github.com/Bobcat/llm-pool)
  provides text model inference and runtime model administration.
- [image-pool](https://github.com/Bobcat/image-pool)
  provides image generation, image editing, image model administration, and
  LoRA training execution.
- `tts-pool`
  provides TTS model inference and runtime model administration.
- `translation-services`
  provides image translation, prompt storage, artifacts, and regression
  fixtures.
- [realtime-translation-engine](https://github.com/Bobcat/realtime-translation-engine)
  provides reusable translation state and dispatch behavior.
- [omniscripta](https://github.com/Bobcat/omniscripta)
  can produce `.pc` replay files from realtime transcript streams.

## Code Map

### Backend

- `app/main.py` creates the FastAPI app, mounts `/api`, exposes websocket
  routes, and serves the frontend.
- `app/router.py` wires backend route groups.
- `app/llm_pool/` proxies `llm-pool` model and admin APIs.
- `app/tts_pool/` proxies `tts-pool` model and admin APIs.
- `app/image_pool/` proxies `image-pool` model, LoRA, generation, editing, and
  training APIs. It also manages workbench-side training datasets.
- `app/translation_services/` proxies the `translation-services` API.
- `app/prompt_testing/` implements text generation and chat requests through
  `llm-pool`.
- `app/realtime_translation/` contains the replay playground and prompt-library
  endpoints.
- `app/realtime_tts/` contains the TTS replay playground.
- `promptlib/` contains prompt-library storage helpers.

### Frontend

- `static/index.html` is the browser entrypoint.
- `static/app.js` registers sidebar groups and workflow views.
- `static/foundation/spa-foundation/` contains the shared shell, routing, modal,
  and sidebar helpers.
- `static/src/api-client.js` contains same-origin API helpers and replay
  websocket clients.
- `static/src/workflows/` contains the workflow views.
- `static/css/` contains shared application styling.

### Support Files

- `config/settings.json` contains committed defaults.
- `config/local.json` is ignored and can override local settings.
- `data/realtime_translation/sample/` contains sample `.pc` replay files.
- `docs/` contains design notes and working observations.
- `deploy/systemd/` contains example local service wiring.
- `tests/` contains backend tests.

## Backend Contract

The frontend calls the workbench backend on the same origin. The workbench then
calls the configured local service.

Main endpoint families:

| Endpoint family | Role |
| --- | --- |
| `/api/models*` | `llm-pool` models, admin state, load/unload, and GPU memory. |
| `/api/text-generation/run` | Single-turn text generation through `llm-pool`. |
| `/api/chat/run` | Chat through `llm-pool`. |
| `/api/prompts/test-translation` | Prompt rendering and test translation for the replay playground. |
| `/api/tts-pool/models*` | `tts-pool` models, admin state, load/unload, and GPU memory. |
| `/api/image-pool/models*` | `image-pool` models, admin state, load/unload, and GPU memory. |
| `/api/image-pool/images/*` | Image generation and image edit requests through `image-pool`. |
| `/api/image-pool/loras` | LoRA discovery for image generation. |
| `/api/image-pool/training/*` | Dataset management, captioning, training start/stop, and training status. |
| `/api/translation/*` | `translation-services` requests, prompts, artifacts, and regression fixtures. |
| `/api/pdf-translation/*` | `translation-services` PDF translation requests and document artifacts. |
| `/api/pdf-benchmark/*` | `translation-services` PDF benchmark results, testset listing, and scoring runs. |
| `/api/replay*` | Realtime translation replay sessions. |
| `/api/realtime-tts/replay*` | Realtime TTS replay sessions and audio artifacts. |
| `/ws/replay/{session_id}` | Translation replay websocket updates. |
| `/ws/replay-speak/{session_id}` | TTS replay websocket updates. |

## Runtime Model

The workbench is a single FastAPI process with a static frontend.

The backend owns workbench state while a session is active. Replay state lives
in memory. Image training datasets and generated training artifacts live under
`data/image_pool/`, which is ignored by git.

The backend does not load AI models directly. Model inference and model
lifecycle are delegated to local pool or service processes.

The sidebar is currently registered in `static/app.js`. Service base URLs are
already configurable. The intended direction is to move enabled sidebar groups
into settings while keeping view implementations in the frontend registry. That
would allow an installation to expose only the consoles it needs, such as an
LLM Pool-only workbench.

## Configuration

Committed defaults live in:

```text
config/settings.json
```

Machine-local overrides can be placed in:

```text
config/local.json
```

`config/local.json` is ignored by git.

Configured service connections:

| Settings key | Default |
| --- | --- |
| `llm_pool.base_url` | `http://127.0.0.1:8011` |
| `tts_pool.base_url` | `http://127.0.0.1:8020` |
| `image_pool.base_url` | `http://127.0.0.1:8013` |
| `translation_services.base_url` | `http://127.0.0.1:8030` |

Environment overrides:

| Variable | Overrides |
| --- | --- |
| `LLM_RESPONSES_API_BASE_URL` | `llm_pool.base_url` |
| `TTS_POOL_API_BASE_URL` | `tts_pool.base_url` |
| `IMAGE_POOL_API_BASE_URL` | `image_pool.base_url` |
| `TRANSLATION_SERVICES_API_BASE_URL` | `translation_services.base_url` |

Replay defaults also live under `replay` in `config/settings.json`.

## Development

Create an environment and install the workbench:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -e .
```

Install the realtime translation engine when working on replay translation:

```bash
./.venv/bin/python -m pip install -e ../realtime-translation-engine
```

Install test tooling if the environment does not already have it:

```bash
./.venv/bin/python -m pip install pytest
```

Run the backend:

```bash
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000/
```

The CLI entrypoint is also available:

```bash
./.venv/bin/python -m app
```

## Verification

Run the Python tests:

```bash
./.venv/bin/python -m pytest tests
```

The tests are mostly `unittest`-style tests and can also be run with:

```bash
./.venv/bin/python -m unittest discover -s tests
```

There is no JavaScript build step. If Node is installed, individual ES modules
can be syntax-checked with `node --input-type=module --check`, but Node is not a
declared project dependency.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
