# Translation Replay Dev

Small standalone replay and simulation harness for streaming translation.

The repo has three practical workflows:

- replay a `.pc` transcript file and inspect translation decisions
- run a single smoke translation on the first committed chunks

## Requirements

Python 3.11 or newer. The project dependencies are declared in `pyproject.toml`.

For local development, install the package in editable mode from the repo root:

```bash
python -m pip install -e .
```

For the `ct2-eurollm` translation path, this repo now expects the sibling `llm-responses-api-dev` service to be running on `http://127.0.0.1:8010`.

## `.pc` Format

Each line is one event:

```text
p,<preview text>
c,<new committed text>
```

Semantics:

- `p` replaces the full current preview state.
- `c` appends a committed delta.
- `p,` is valid and represents an empty preview.

The parser splits only on the first comma.

## Replay

From the repo root:

```bash
python -m app replay sample/sample.pc
```

Useful flags:

```bash
python -m app replay sample/sample.pc --verbose --dump-end-state
python -m app replay sample/sample.pc --max-events 4
python -m app replay sample/sample.pc --translator dummy --dummy-mode echo
```

Replay behavior:

- `p` updates source preview state only.
- `c` appends committed source state, clears source preview state, and triggers translation.
- the core keeps an open source block since the last source sentence boundary
- that open source block is fully retranslated on each committed update
- selected `p` events can also trigger preview translation when the preview is long enough, stable enough, and has grown enough since the last preview call
- target state is maintained as `target_committed_text + target_preview_text`
- target preview is committed only when the latest source chunk ends a sentence (`.`, `?`, `!`)
- no target overlap heuristic is used
- replay thresholds live in `settings.json`

The core does not know whether events come from replay or a live source.

## Smoke Test

Use this when you want a single end-to-end translation check:

```bash
python -m app smoke sample/live_20260406T165024Z_c3e7a33e.pc --c-count 2
```

The smoke command:

- collects the first `N` committed chunks
- joins them into one source window
- sends that window through the configured `llm-responses-api-dev` service
- prints source text, target text, and latency

## Tests

Run:

```bash
python -m unittest discover -s tests
```

## Project Layout

- `app/events.py`: event model and `.pc` parser
- `app/source_state.py`: source committed/preview state machine
- `app/core.py`: event-driven translation core and target state
- `app/translators.py`: EuroLLM/CT2 translator wrapper and dummy translator
- `app/replay.py`: replay runner that wires parser, source state, and core together
- `app/cli.py`: command-line entrypoint
- `sample/sample.pc`: small replayable example
- `tests/`: unit tests
