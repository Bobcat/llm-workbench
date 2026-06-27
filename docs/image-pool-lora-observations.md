# Image Pool LoRA Observations

Status: working notes.

These notes capture local observations from image-pool LoRA experiments. They
are not final training recommendations yet.

## Current Runs

### Z-Image LoRA Run `20260627-142145`

Training output:

```text
data/image_pool/training/z-image/runs/20260627-142145/
```

Training request summary:

| Field | Value |
| --- | --- |
| Trainer | `z-image` |
| Training model | `z-image-base` |
| Dataset | `bfl-graphic-impressions` |
| Trigger word | `GFX_IMPR5N` |
| Steps | `1000` |
| Learning rate | `0.0001` |
| Rank | `4` |
| Alpha | `4` |
| Batch size | `1` |
| Resolution | `1024` |
| Checkpoint interval | `250` |

Artifacts:

```text
pytorch_lora_weights.safetensors
checkpoints/step-000250/pytorch_lora_weights.safetensors
checkpoints/step-000500/pytorch_lora_weights.safetensors
checkpoints/step-000750/pytorch_lora_weights.safetensors
checkpoints/step-001000/pytorch_lora_weights.safetensors
request.json
train.log
```

The run completed cleanly. Final loss was about `0.2468`, but loss should not
be treated as the main quality signal for style LoRAs. Checkpoint image
comparison matters more.

## Z-Image Turbo Inference Tests

Target inference model:

```text
z-image-turbo
```

Base inference settings:

| Field | Value |
| --- | --- |
| Size | `1024x1024` |
| Steps | `9` |
| Guidance | `0.0` |
| Seeds | Fixed per prompt |
| Prompt trigger | Included |

Evaluation output:

```text
data/image_pool/evals/z-image-lora-20260627-142145-turbo/
data/image_pool/evals/z-image-lora-20260627-142145-turbo-strength/
```

Contact sheets:

```text
data/image_pool/evals/z-image-lora-20260627-142145-turbo/contact-sheet.png
data/image_pool/evals/z-image-lora-20260627-142145-turbo-strength/contact-sheet.png
```

### Observed LoRA Scale Behavior

| LoRA scale | Observation |
| ---: | --- |
| `1.0` | Technically works, but the visual effect is subtle. |
| `1.75` | Much clearer style effect; currently the best-looking default candidate. |
| `2.0` | Strongest effect, but can become too flat/cartoon-like on some prompts. |

For this run, `1.5` to `1.75` looks like a better default range than `1.0` when
using the LoRA on `z-image-turbo`.

The LoRA effect is most visible in:

- stronger black outlines
- cleaner flat color regions
- more graphic illustration style
- simpler shapes and backgrounds

The effect can become too strong at high scale:

- reduced texture detail
- flatter faces and clothing
- more cartoon-like composition

## Training Parameter Hypotheses

The current Z-Image run is probably closer to a smoke test than a final
production-quality style LoRA:

- `1000` steps may be low for this dataset/style.
- `rank=4` may be low if we want stronger style transfer.
- Training on `z-image-base` and inferring on `z-image-turbo` transfers, but the
  high inference scale needed suggests the match may not be ideal.

Community material found so far suggests testing:

| Parameter | Candidate values |
| --- | --- |
| Steps | `2000`, `2500`, `3000` |
| Rank | `8`, `16` |
| Alpha | same as rank |
| Learning rate | `0.00005` to `0.0001` |
| Batch size | `1` |
| Resolution | `1024` |
| Checkpoint interval | `250` or `300` |

For Z-Image Turbo specifically, the interesting next path is training with the
Ostris Z-Image Turbo training adapter:

```text
ostris/zimage_turbo_training_adapter
```

The idea is to train in a way that preserves the step-distilled Turbo behavior,
then use the resulting LoRA on `z-image-turbo`.

## FLUX.2 Klein Notes

For FLUX.2 klein, current external guidance and local tests point to a different
split:

- train on a `base` model
- infer with the corresponding distilled model when speed matters
- inspect checkpoints rather than assuming final checkpoint is best

For the BFL Graphic Impressions style tutorial, the BFL example uses a larger
training setup than our initial minimal trainers:

| Parameter | BFL-style direction |
| --- | --- |
| Steps | around `3000` |
| Learning rate | around `0.000095` |
| Resolution | multi-resolution buckets up to `1536` |
| Checkpoints | frequent enough to compare style drift |

An important BFL tutorial observation is that an intermediate checkpoint can be
better than the final checkpoint. In their Graphic Impressions example, later
training can move the result away from the desired painterly/graphic style.

## Suggested Admin API Direction

The admin API should eventually expose training and inference parameter
metadata per model/backend. The workbench can then render defaults and reset
controls without hardcoding them.

Candidate shape:

```json
{
  "training_capabilities": {
    "z-image-lora": {
      "compatible_training_models": ["z-image-turbo"],
      "compatible_inference_models": ["z-image-turbo"],
      "presets": {
        "style": {
          "steps": 2500,
          "checkpoint_interval": 250,
          "learning_rate": 0.0001,
          "rank": 16,
          "alpha": 16,
          "resolution": 1024,
          "batch_size": 1,
          "training_adapter": "ostris/zimage_turbo_training_adapter"
        }
      }
    }
  },
  "inference_lora_defaults": {
    "z-image-turbo": {
      "scale_default": 1.75,
      "scale_min": 0.0,
      "scale_max": 2.0,
      "scale_step": 0.05
    }
  }
}
```

For FLUX.2 klein, the same structure should make the training/inference split
explicit:

```json
{
  "training_capabilities": {
    "flux2-klein-lora": {
      "compatible_training_models": ["flux2-klein-base-4b"],
      "compatible_inference_models": ["flux2-klein-4b"],
      "presets": {
        "style": {
          "steps": 3000,
          "checkpoint_interval": 250,
          "learning_rate": 0.000095,
          "rank": 128,
          "alpha": 64,
          "batch_size": 1,
          "resolution": [256, 512, 768, 1024, 1280, 1536]
        }
      }
    }
  }
}
```

## Next Experiments

1. Train Z-Image Turbo with the Turbo training adapter.
2. Compare `rank=8` vs `rank=16`.
3. Compare `2000`, `2500`, and `3000` steps.
4. Save checkpoints every `250` steps.
5. Evaluate checkpoints on the same fixed prompt/seed set.
6. Evaluate LoRA scales `1.0`, `1.5`, `1.75`, and `2.0`.
7. Keep `steps=9` and `guidance=0.0` for initial Turbo inference tests so the
   inference side stays stable while training parameters change.

## Open Questions

- Is `z-image-base -> z-image-turbo` LoRA transfer good enough, or should Turbo
  always be trained with the Turbo adapter?
- Is `1.75` a generally useful default or only needed because this run used
  too few steps/rank?
- Does a checkpoint before step `1000` look better than the final checkpoint?
- Should the UI default LoRA scale be model-specific, LoRA-specific, or both?
