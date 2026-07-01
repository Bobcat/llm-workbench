# Pool And Service Ops Inventory

Status: working notes.

This note captures the current direction for pool/service consoles, runtime
admin APIs, and future workbench observability. It is an inventory and roadmap,
not an implemented design.

## Service Classes

The workbench should distinguish pool services from higher-level services.

### Pool Services

Pool services own model runtime and model lifecycle.

Current and expected pools:

- `llm-pool`
- `tts-pool`
- `image-pool`
- `asr-pool`

Pool consoles should expose model lifecycle and runtime state:

- configured models
- loaded/unloaded/loading state
- load/unload actions
- GPU or memory usage
- inflight requests and queue depth
- recent load errors

### Higher-Level Services

Higher-level services own workflows, artifacts, prompt/config state, or shared
domain objects.

Current and expected services:

- `translation-services`
- future `tts-services`

`tts-services` is different from `tts-pool`. `tts-pool` owns TTS model runtime.
`tts-services` would own shared voice-library concerns:

- stable generated voices
- voice profiles
- reusable voice assets and metadata
- VoxCPM-related voice configuration shared by multiple apps

There is no planned `asr-services` layer at this point.

## Current Workbench Direction

The workbench should become a configurable browser shell for service consoles.

The intended shape:

- settings define which console groups are enabled
- code defines what each view does
- an installation can expose only the groups it needs

Example target:

```json
{
  "workbench": {
    "enabled_groups": ["llm_pool"]
  },
  "llm_pool": {
    "base_url": "http://127.0.0.1:8011"
  }
}
```

That installation would show only:

- `LLM Pool / Models`
- `LLM Pool / Text generation`
- `LLM Pool / Chat`

The sidebar is currently still registered in `static/app.js`. Service base URLs
are already configurable in `config/settings.json` and `config/local.json`.

## Runtime Admin API Baseline

Each pool should eventually expose a small runtime admin API.

Baseline endpoints:

```http
GET /healthz
GET /v1/models
GET /v1/admin/models
GET /v1/admin/gpu-memory
POST /v1/admin/models/{model_name}/load
POST /v1/admin/models/{model_name}/unload
```

Expected admin model fields:

- model id/name
- backend
- configured enabled state
- runtime state
- loaded flag
- loading flag
- scheduler state
- last error
- model path or configured artifact id
- VRAM estimate
- capabilities

The exact payload can differ by service, but workbench adapters should normalize
the fields needed for the UI.

## ASR Pool First

`asr-pool` should be the next practical target.

Current pain:

- ASR models can hold useful VRAM.
- Freeing that VRAM currently requires manually stopping the service.
- Starting the service again is manual.

The first useful improvement is a runtime admin API inside `asr-pool`.

Goal:

- unload ASR models without stopping the service
- load them again from the admin API
- inspect runtime state and memory usage

The workbench UI can come after the API exists.

Suggested phases:

1. Add runtime admin API to `asr-pool`.
2. Verify load/unload with `curl`.
3. Add `asr_pool.base_url` to workbench settings.
4. Add workbench backend proxy routes.
5. Add `ASR Pool / Models` console.
6. Later include ASR Pool in aggregated status/notifications.

Important unload behavior:

- unregister scheduler/executor
- drop model/runtime objects
- release CUDA or backend-specific memory where possible
- mark model as unloaded
- reject inference requests for unloaded models with a clear error

## Ops Versus Observability

Ops and observability are related but not the same.

### Observability

Observability is read-only.

Examples:

- service reachability
- health status
- loaded models
- GPU and memory usage
- queues and inflight requests
- active jobs
- recent errors
- log tails
- request metrics
- training progress

### Ops

Ops changes state.

Examples:

- load a model
- unload a model
- cancel a job
- stop a training run
- clear a queue
- reload config
- archive or delete old artifacts
- restart a service, if the service exposes a safe action for it

The UI should keep this distinction clear. Observability can be passive and
always visible. Ops actions should be explicit.

## Workbench Notifications Direction

The workbench can later poll enabled services and aggregate status into a
notifications workflow.

This does not need a heavy monitoring stack at first.

Initial shape:

- each enabled service group declares status endpoints
- the backend polls those endpoints on an interval
- the backend stores a small in-memory status snapshot
- the frontend shows badges and a notifications view

Possible notification types:

- service unreachable
- model load failed
- model unloaded unexpectedly
- training completed
- training failed
- queue stuck
- GPU memory above threshold
- translation request failed
- regression run failed

Notifications should link back to the relevant console:

- training completed -> `Image Pool / Train`
- model load failed -> matching pool `Models` page
- regression failed -> `Translation Services / Regression testing`
- service unreachable -> matching service console

## Open Questions

- Which existing pools already expose admin APIs and which still need them?
- Does `asr-pool` already have an ops page, and which parts should be reused?
- Should workbench polling live in the FastAPI backend or only in the browser?
- Should notifications be runtime-only first, or persisted later?
- Should ops actions require a confirmation layer or permission model?
- Should service restart ever be owned by workbench, or should it stay outside
  the app until there is a safe supervisor contract?
