# LLM Workbench

LLM Workbench is the backend for a small personal workbench/playground for trying out LLM-driven workflows.

Some parts are meant to stay as permanent tools, especially:
- `LLM Pool / Models`
- `Prompt Testing / Ad hoc prompt`

Other parts are more exploratory. `Realtime Translation / Replay & Translate` started here, and parts of that workflow are already being extracted or reused elsewhere.

## What This Repo Contains

- `LLM Pool / Models`
  Admin tools backed by the llm-pool admin API.
- `Prompt Testing / Ad hoc prompt`
  Run prompts against available models without building a dedicated workflow first.
- `Realtime Translation / Replay & Translate`
  Replay `.pc` transcript events, inspect first-pass and second-pass behavior, and export session state.
- `Realtime Translation / Prompt Library`
  Manage the prompt sets used by the translation workflow.

## Related Repos

- [realtime-translation-engine](https://github.com/Bobcat/realtime-translation-engine)
  Extracted translation engine package used by the Replay & Translate workflow.
- [llm-workbench-ui](https://github.com/Bobcat/llm-workbench-ui)
  Frontend served by this backend in local development through the `static/` symlink.
- [omniscripta](https://github.com/Bobcat/omniscripta)
  Turns realtime transcripts into `.pc` replay files for the Replay & Translate workflow.
- [llm-pool](https://github.com/Bobcat/llm-pool)
  Provides the LLM and admin APIs used by the workbench for model access and prompt-driven workflows.

## Local Setup

```bash
python3 -m venv .venv
./.venv/bin/python -m pip install -e .
./.venv/bin/python -m pip install -e ../realtime-translation-engine
```

## Run

```bash
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Open:

```text
http://127.0.0.1:8000/
```

## Configuration

- `config/settings.json` contains committed defaults
- `config/local.json` is for local overrides

## Tests

```bash
./.venv/bin/python -m unittest discover -s tests
```
