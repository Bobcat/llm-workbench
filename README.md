# LLM Workbench

LLM Workbench is the backend for a small personal workbench/playground for trying out LLM-driven workflows.

Some parts are meant to stay as permanent tools, especially:
- `LLM Pool / Models`
- `Prompt Testing / Ad hoc prompt`

Other parts are more exploratory. `Realtime Translation / Replay & Translate` started here, and parts of that workflow are already being extracted or reused elsewhere.

## Index

- [What It Does](#what-it-does)
- [Repository Role](#repository-role)
- [Related Repositories](#related-repositories)
- [Code Map](#code-map)
- [API Surface](#api-surface)
- [Runtime Model](#runtime-model)
- [Configuration](#configuration)
- [Local Development](#local-development)
- [Tests](#tests)
- [Screenshots](#screenshots)
- [License](#license)

## What It Does

- `LLM Pool / Models`
  List, load, unload, and inspect models through the `llm-pool` admin API.
- `Prompt Testing / Ad hoc prompt`
  Run one-off prompts against available models without building a dedicated workflow first.
- `Realtime Translation / Replay & Translate`
  Replay `.pc` transcript event streams, inspect first-pass and second-pass translation behavior, and export session state.
- `Realtime Translation / Prompt Library`
  Manage prompt sets used by the translation workflow.

## Repository Role

- This repo provides the FastAPI API, replay session orchestration, prompt-library storage, and `llm-pool` proxy routes.
- The backend expects the browser UI to be served from `static/` or from another same-origin static deployment.
- The backend does not run model inference itself; model calls go through `llm-pool`.
- Replay translation runtime behavior is delegated to the extracted realtime translation engine.

## Related Repositories

- [llm-workbench-ui](https://github.com/Bobcat/llm-workbench-ui)
  Browser UI for this backend.
- [realtime-translation-engine](https://github.com/Bobcat/realtime-translation-engine)
  Extracted translation runtime used by the replay workflow.
- [llm-pool](https://github.com/Bobcat/llm-pool)
  Provides the model and admin APIs used by the workbench.
- [omniscripta](https://github.com/Bobcat/omniscripta)
  Can produce `.pc` replay files from realtime transcript streams.

## Code Map

- `app/main.py` creates the FastAPI app, mounts API routes, exposes the replay websocket, and optionally serves the frontend from `static/`.
- `app/router.py` wires the `/api` router groups.
- `app/llm_pool/` proxies model listing and model admin actions to `llm-pool`.
- `app/prompt_testing/` implements the ad hoc prompt runner.
- `app/realtime_translation/replay/` manages replay sessions, translation dispatch, runtime export, websocket transport, and metrics.
- `app/realtime_translation/prompt_library/` manages translation prompt sets.
- `promptlib/` contains prompt-library storage helpers.
- `config/settings.json` contains committed defaults.
- `data/realtime_translation/sample/` contains sample `.pc` replay files.
- `deploy/systemd/` contains example service wiring for local deployments.

## API Surface

- `/api/models*` exposes model listing and model admin proxy routes.
- `/api/prompts/run` runs ad hoc prompts.
- `/api/prompts*` manages the realtime translation prompt library.
- `/api/replay*` creates and controls replay sessions.
- `/ws/replay/{session_id}` streams replay updates to the UI.

## Runtime Model

LLM Workbench keeps workflow state in the backend process while a session is active. The browser creates replay sessions, updates model/prompt/language settings over HTTP, and receives replay events over a websocket.

Model inference and model administration are external concerns owned by `llm-pool`. Translation replay orchestration lives in this backend, while reusable translation state and dispatch behavior is implemented in `realtime-translation-engine`.

The optional `static/` directory is only the frontend delivery mechanism. It can be a symlink to `llm-workbench-ui` during development or a copied static deployment in another environment.

## Configuration

- `config/settings.json` contains committed defaults.
- `config/local.json` is ignored and can be used for local overrides.
- `deploy/systemd/llm-pool-tunnel.example.service` shows one way to tunnel a remote `llm-pool` API to `127.0.0.1:8011`.

## Local Development

Install the backend and the extracted translation engine in editable mode:

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -e .
./.venv/bin/python -m pip install -e ../realtime-translation-engine
```

The browser UI is developed in the separate `llm-workbench-ui` repo. In local development this backend serves it when a `static/` symlink or directory is present.

```bash
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000/
```

## Tests

```bash
./.venv/bin/python -m unittest discover -s tests
```

## Screenshots

### Prompt Library

![Prompt library and translation prompt test fields](assets/screenshots/llm-workbench-01.png)

### Replay & Translate

![Completed replay and translated transcript output](assets/screenshots/llm-workbench-02.png)

### Model Pool

![Model pool overview with loaded and unloaded models](assets/screenshots/llm-workbench-03.png)

### Model Settings

![Model load settings and runtime metadata](assets/screenshots/llm-workbench-04.png)

### Ad Hoc Prompt Testing

![Ad hoc prompt testing with response metrics](assets/screenshots/llm-workbench-05.png)

### Replay Metrics

![Replay run metrics and developer timing tools](assets/screenshots/llm-workbench-06.png)

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE).
