# TTS Baseline Note

## Purpose

This note records the current text-to-speech experiment baseline for replay translation.

The goal is not to define the final realtime interpreter architecture yet.
The goal is to keep the current Kokoro setup measurable and comparable before adding another engine.

## Current Scope

The current implementation is a development-only replay experiment.

Flow:

- replay translation produces committed target text
- committed target deltas are sent to TTS
- TTS produces one WAV clip per committed target delta
- after replay completion, clips are concatenated into one full replay WAV
- the UI can play that full WAV after completion

The current player is intentionally not the main feature.
It is only a validation tool for hearing how the committed target stream would have sounded.

## Current Engine

Engine:

- `kokoro`

Package boundary:

- reusable TTS package: `realtime-tts-engine`
- workbench integration: `app/realtime_translation/replay/tts.py`
- browser display: `llm-workbench-ui` replay workflow

The workbench currently hosts the TTS experiment directly.
There is no separate TTS pool or scheduler yet.

## Why Kokoro Is The Baseline

Kokoro is the lightweight local baseline.

It is useful for:

- quick local iteration
- speed and latency measurements
- establishing whether local TTS can stay comfortably faster than realtime
- providing a comparison point for larger or more expressive engines

It is not assumed to be the final quality target.

## Metrics

The TTS runtime card is intended to compare engines using the same shape of metrics.

Current metrics:

- `engine`: effective TTS engine name
- `voice`: effective voice identifier
- `language`: requested target language plus engine language code where available
- `clips`: number of TTS clips generated
- `input chars`: total text characters sent to TTS
- `audio duration`: generated audio playback duration
- `TTFA p50/p95`: time from synthesize start until first audio chunk from the engine
- `RTF p50/p95`: synthesize wall time divided by generated audio duration
- `chars/sec p50/p95`: input characters divided by synthesize wall time
- `audio duration/sec p50/p95`: generated audio seconds divided by synthesize wall seconds
- `runtime total`: total synthesize wall time accumulated over clips
- `infer`: engine inference time accumulated over clips
- `wav`: WAV assembly/encoding time accumulated over clips
- `underruns`: currently `n/a`

Interpretation:

- `RTF < 1.0` means generation is faster than realtime.
- `audio duration/sec > 1.0` is the inverse view of RTF.
- `TTFA` is currently measured inside the local TTS engine, not in the browser.

## Measurement Boundary

Current measurements are backend/replayer-side measurements.

Measured:

- Kokoro generator first-audio time
- Kokoro inference loop time
- WAV concat/encode time
- total synthesize wall time
- generated WAV duration

Not measured yet:

- websocket delivery latency
- browser download time
- browser decode latency
- browser `play()` start latency
- real streaming buffer health
- playback underruns

This is acceptable for the current baseline because the goal is to compare local TTS engine behavior first.

## Playback Boundary

The current playback UI is not streaming.

It plays the full replay WAV after replay completion.

The visible player should use the expected full-WAV duration from the backend payload, not infer correctness from the browser native WAV controls.

The current player exists to answer:

- "What would this replay have sounded like?"

It does not answer:

- "Can this stream live without underruns?"

## Current Non-Goals

This baseline does not introduce:

- a TTS pool
- a scheduler
- multi-engine routing
- streaming PCM playback
- browser underrun tracking
- speaker diarization or voice cloning
- emotional/prosodic transfer

Those can be added only after the simple baseline is stable and measurable.

## Next Engine Candidate

The next engine candidate is Voxtral 4B or another higher-quality local TTS/multimodal candidate.

It should be added beside Kokoro, not replacing Kokoro.

Comparison should use the same metrics:

- TTFA p50/p95
- RTF p50/p95
- chars/sec
- audio duration/sec
- voice
- language
- input chars

Possible reasons to keep a larger engine:

- better quality
- better Dutch support
- more expressive output
- better streaming behavior

Possible reasons not to keep it:

- too slow
- too much VRAM
- unstable latency
- unclear licensing or integration path

## Extraction Direction

The current package boundary is deliberately small:

- text in
- language in
- WAV bytes out
- timings and metadata out

That boundary should remain simple until a second engine proves useful.

If the experiment grows beyond replay validation, a future extraction can introduce:

- a realtime TTS engine package API extension
- a TTS worker/pool
- streaming chunk output
- browser playback-buffer metrics

Do not build those before the second engine comparison justifies them.
