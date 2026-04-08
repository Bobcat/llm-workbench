# Translation Replay Dev

Small standalone replay and simulation harness for streaming translation.

The repo has three practical workflows:

- replay a `.pc` transcript file and inspect translation decisions
- run a single smoke translation on the first committed chunks
- open a small browser judge to compare prompt variants

## Requirements

Python 3.11 or newer. The project dependencies are declared in `pyproject.toml`.

For local development, install the package in editable mode from the repo root:

```bash
python -m pip install -e .
```

For the EuroLLM/CT2 translation path, the environment needs `ctranslate2` and `transformers`. For the browser judge, it also needs `fastapi` and `uvicorn`.

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
- the translator can also receive the previous committed source chunk as extra context, without translating that context again
- selected `p` events can also trigger preview translation when the preview is long enough, stable enough, and has grown enough since the last preview call
- target state is maintained as `target_committed_text + target_preview_text`
- target preview is committed only when the latest source chunk ends a sentence (`.`, `?`, `!`)
- no target overlap heuristic is used
- replay thresholds and context settings live in `settings.json`

The core does not know whether events come from replay or a live source.

## Smoke Test

Use this when you want a single end-to-end translation check:

```bash
python -m app smoke sample/live_20260406T165024Z_c3e7a33e.pc --c-count 2
```

The smoke command:

- collects the first `N` committed chunks
- joins them into one source window
- sends that window through the EuroLLM/CT2 translator
- prints source text, target text, and latency

## Browser Judge

Start the local A/B judge from the repo root:

```bash
python -m app judge-web sample/live_20260406T165024Z_c3e7a33e.pc --window-chunks 2 --max-items 20 --port 8002
```

Then open the printed local URL in your browser.

To compare baseline against one of the built-in alternatives, add `--comparison-prompt ...`.
Available comparison options are `baseline_topk5_temp03`, `baseline_nl`, `faithful_nl_compact`, `natural_nl`, `simple_nl`, `spoken_nl`, `superior_nl`, and `syntactic_nl`.

The judge page shows:

- the source window
- output A and output B, anonymously
- a winner choice: `A`, `B`, or `tie`
- optional `naturalness` and `faithfulness` scores from `1` to `5`
- a summary page with a downloadable text export of prompt names, inputs, and outputs

Judgments are appended to `tmp/judge-results.jsonl`.

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
- `app/judge_web.py`: small FastAPI judge for prompt A/B testing
- `app/cli.py`: command-line entrypoint
- `sample/sample.pc`: small replayable example
- `tests/`: unit tests
