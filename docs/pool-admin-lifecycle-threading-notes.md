# Pool Admin Lifecycle Threading Notes

Status: working notes.

This note describes the shared lifecycle and threading model we want for
model-owning pool admin APIs.

The workbench should be able to treat these pools the same way:

- `llm-pool`
- `tts-pool`
- `image-pool`
- `video-pool`

The comparison started because a pool can look unreachable while a model is
loading if the load path blocks the FastAPI event loop. That was the symptom.
The design goal is broader: all four pools should expose the same admin
lifecycle behavior.

## Current Situation

| Pool | Current load route model | Blocking boundary | Workbench polling during load | Notes |
| --- | --- | --- | --- | --- |
| `llm-pool` | Sync FastAPI route: `def load_model(...)` | FastAPI runs the whole route in its threadpool | Good | Behavior is good, but the threading boundary is implicit. Loading is tracked as runtime state. Duplicate load while loading returns current state unless load overrides are requested. |
| `tts-pool` | Sync FastAPI route: `def load_model(...)` | FastAPI runs the whole route in its threadpool | Good | Behavior is good, but the threading boundary is implicit. Lifecycle state is simpler than `llm-pool`. |
| `image-pool` | Async FastAPI route: `async def load_model(...)` | Runtime creation is explicitly moved to `asyncio.to_thread(...)` | Good after the recent fix | Load now follows the target pattern. Unload cleanup and lifecycle guards still need the shared hardening pass. |
| `video-pool` | Async FastAPI route: `async def load_model(...)` | Runtime creation is explicitly moved to `asyncio.to_thread(...)` | Good after the recent fix | Load follows the target pattern. Unload cleanup and lifecycle guards still need the shared hardening pass. |

`asr-pool` is intentionally excluded here. It uses a runner/service model with
background tasks, subprocesses, and explicit `asyncio.to_thread(...)` calls
around heavy runner operations.

## Target Pattern

Pools should use one explicit lifecycle model for common admin API actions.

FastAPI routes stay async:

```python
@app.post("/v1/admin/models/{model_name}/load")
async def load_model(model_name: str, load_request: AdminLoadRequest | None = None) -> dict:
    return await engine.load_model(model_name, load_request)
```

The engine marks state before starting heavy work:

```python
state.loading = True
state.last_error = None
```

Heavy blocking work runs outside the event loop:

```python
runtime = await asyncio.to_thread(self._create_runtime, model_name, runtime_settings)
```

The same applies to unload if cleanup can block:

```python
await asyncio.to_thread(self._close_runtime, runtime)
```

Read-only admin endpoints should stay fast:

- `GET /healthz`
- `GET /v1/models`
- `GET /v1/admin/models`
- `GET /v1/admin/gpu-memory`

If a read-only endpoint shells out or calls a slow library, that specific call
should also move to a thread.

## Desired State By Pool

The desired state is one shared model, not four pool-specific models. Each pool
should expose the same lifecycle semantics to the workbench. Implementation
details may differ behind the API.

| Pool | Desired situation | Remaining gap |
| --- | --- | --- |
| `llm-pool` | Shared async admin lifecycle model with explicit thread offload for blocking lifecycle work. | Current behavior works through FastAPI's implicit sync-route threadpool. Migration is for consistency, not urgency. |
| `tts-pool` | Shared async admin lifecycle model with explicit thread offload for blocking lifecycle work. | Current behavior works through FastAPI's implicit sync-route threadpool. Migration is for consistency, not urgency. |
| `image-pool` | Shared async admin lifecycle model with explicit thread offload for blocking lifecycle work. | Load now matches the target. Add common `unloading` state and duplicate load/unload guards. |
| `video-pool` | Shared async admin lifecycle model with explicit thread offload for blocking lifecycle work. | Load now matches the target. Add common `unloading` state and duplicate load/unload guards. |

## Lifecycle Rules

The common behavior should be:

- `load` sets state to `loading` before model construction starts.
- `GET /v1/admin/models` returns during `loading`.
- `GET /v1/admin/gpu-memory` returns during `loading`.
- a duplicate `load` while `loading` returns the current state or a clear `409`.
- `load` with overrides while `loaded` or `loading` is rejected.
- `unload` sets state to `unloading` before cleanup starts.
- a duplicate `unload` while `unloading` returns the current state or a clear `409`.
- inference requests against unloaded/loading/unloading models fail with a clear model-state error.
- on load failure, state records `last_error` and returns to a non-loaded state.

## Migration Order

1. Harden `video-pool` lifecycle state.
2. Harden `image-pool` lifecycle state in the same way.
3. Add or update tests that poll admin state while load and unload are in progress.
4. Consider migrating `llm-pool` and `tts-pool` from implicit sync-route threading to the explicit async pattern.

The short-term goal is consistent behavior in the workbench. The longer-term
goal is one pool admin lifecycle model that is easy to document, test, and reuse
across all model-owning pools.
