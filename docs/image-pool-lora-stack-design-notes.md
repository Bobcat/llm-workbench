# Image Pool LoRA Stack Design Notes

Status: draft.

These notes capture the intended LoRA stack direction for image generation and
training. The feature is not implemented yet.

## Current State

The workbench supports one LoRA at a time for image generation.

The generation view sends these fields in request metadata:

```json
{
  "lora_id": "z-image/dataset/20260627-142145",
  "lora_path": "/path/to/pytorch_lora_weights.safetensors",
  "lora_scale": 1.75
}
```

The image-pool runtime then loads that LoRA as one adapter and applies the
requested scale. A request without a LoRA sets the active adapter weight to
`0.0`.

## Target Concept

A LoRA stack is an ordered list of LoRA adapters used for one generation or
training request.

Example:

```json
{
  "lora_inputs": {
    "mode": "stack",
    "items": [
      {
        "id": "z-image/graphic-impressions/20260627-142145",
        "path": "/path/to/final/pytorch_lora_weights.safetensors",
        "scale": 0.7,
        "order": 0
      },
      {
        "id": "z-image/red-lighting/20260628-101500/checkpoints/step-000500",
        "path": "/path/to/checkpoints/step-000500/pytorch_lora_weights.safetensors",
        "scale": 0.35,
        "order": 1
      }
    ]
  }
}
```

For inference, the effective model is conceptually:

```text
base model + scale A * LoRA A + scale B * LoRA B
```

The scale is the main control. Order is usually less important than scale, but
it should be stored and displayed because backend behavior can differ.

## Generation UI

The image generation view should keep the main generation parameters compact.

Add a nested `LoRA stack` details section inside `Generation parameters`:

- LoRA dropdown
- strength control for the LoRA being added
- `Add` button
- selected LoRA list

Each selected LoRA row should include:

- up/down controls
- LoRA name
- run/checkpoint label
- strength slider or numeric input
- remove button

Do not add a separate edit mode at first. Strength should be editable in place.
This avoids remove/re-add/reorder churn.

## Training UI

The training tab can reuse the same stack control, but the meaning is different.

For generation:

```text
base model + LoRA stack -> image
```

For training:

```text
base model + LoRA stack -> train new LoRA
```

The UI should make this explicit. A future training section could be named
`Training LoRA inputs`.

Possible modes:

- `none`: train directly from the selected base model.
- `stack`: load one or more existing LoRAs while training the new LoRA.
- `continue`: initialize or resume from one existing LoRA or checkpoint.

`stack` and `continue` are different. A stack adds adapter influence during the
run. Continue training uses an existing LoRA or checkpoint as the starting point
for the output LoRA.

## Training Request Shape

The training request should record LoRA inputs even before all modes are fully
implemented. That gives each run reproducible provenance.

Example:

```json
{
  "model": "z-image-base",
  "dataset_path": "/path/to/dataset",
  "output_path": "/path/to/runs",
  "steps": 1000,
  "checkpoint_interval": 250,
  "resume_from": null,
  "lora_inputs": {
    "mode": "stack",
    "items": [
      {
        "id": "z-image/graphic-impressions/20260627-142145",
        "path": "/path/to/pytorch_lora_weights.safetensors",
        "scale": 0.7,
        "order": 0
      }
    ]
  }
}
```

If the run continues from a checkpoint, record that separately:

```json
{
  "resume_from": {
    "run_id": "20260627-142145",
    "checkpoint_id": "step-000500",
    "path": "/path/to/checkpoints/step-000500"
  }
}
```

## Checkpoint Provenance

If the LoRA stack is fixed for the whole run, storing `lora_inputs` in the
run-level `request.json` is enough. Every checkpoint in that run inherits the
same stack.

Example:

```text
run 20260701-153000
  request.json: stack A+B
  checkpoints/step-000250
  checkpoints/step-000500
```

Both checkpoints were trained with stack A+B.

If the stack can change during a run, run-level metadata is not enough. Store a
segment log:

```json
{
  "segments": [
    {
      "from_step": 0,
      "to_step": 300,
      "lora_inputs": {
        "mode": "stack",
        "items": ["A", "B"]
      }
    },
    {
      "from_step": 301,
      "to_step": 600,
      "lora_inputs": {
        "mode": "stack",
        "items": ["A", "C"]
      }
    }
  ]
}
```

Then `step-000500` can be traced to stack A+C.

First implementation should keep stacks fixed during a run. Segment metadata can
be added later if changing the stack mid-run becomes a real workflow.

## Backend Direction

Diffusers can load multiple LoRAs by giving each adapter a unique name, then
activating them together.

Conceptual runtime flow:

1. Validate all LoRA paths.
2. Load missing adapters with stable adapter names.
3. Remove or deactivate adapters not used by this request.
4. Call `set_adapters(names, adapter_weights=scales)`.
5. Return selected LoRA ids and scales in response metrics.

The workbench should not load LoRA weights. It should send ids, paths, scales,
and order in request metadata.

## Out Of Scope For The First Version

- Drag-and-drop reorder.
- Editing LoRA metadata.
- Merging or baking LoRAs into a base model.
- Changing the stack during an active training run.
- Permission or safety checks for arbitrary filesystem paths.
- Cross-backend guarantees that order affects results.

