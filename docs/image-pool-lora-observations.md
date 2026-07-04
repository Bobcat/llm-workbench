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

## SDXL LoRA Loader Notes

Date: 2026-07-02.

Runtime model:

```text
sdxl-base-1.0
```

SDXL LoRA files can target different model parts:

| Part | Role |
| --- | --- |
| `unet` | Image denoiser. This is where most visual style/object LoRAs attach. |
| `text_encoder` | First SDXL prompt encoder. |
| `text_encoder_2` | Second SDXL prompt encoder. |

Diffusers describes LoRA weights as attachable to the denoiser, the text
encoder, or both. For SDXL, the denoiser is the UNet.

### Tested SDXL LoRA Types

| Type | Test file | Current support |
| --- | --- | --- |
| UNet-only LoRA | `ntc-ai/SDXL-LoRA-slider.cartoon` | Supported. |
| Kohya / SGM SDXL LoRA | imported `Kandinsky` LoRA | Supported after passing the SDXL UNet config into Diffusers conversion. |
| UNet + both text encoders | `Archana99/sdxl-lora-sketch-testing` | Supported. |
| UNet + both text encoders | `jonknownothing/sdxl-lora-advanced-2` | Supported. |
| Text-encoder-only LoRA | local fixture derived from the sketch LoRA | Supported as a loader path. |
| UNet LoRA + separate textual-inversion embedding | `weasley24/dnd-SDXL-LoRA` | LoRA file loads. Separate embedding is not supported yet. |
| SD 1.5 Kohya LoRA configured as SDXL | imported `kandinsky-v1` LoRA | Not supported by SDXL. Needs an SD 1.5 runtime/model path later. |

The first failure was caused by treating every SDXL LoRA as a generic
`load_lora_weights` call. A UNet-only Kohya-style LoRA made Diffusers attempt a
text-encoder load and fail.

The second failure appeared with real text-encoder LoRA keys. The current local
Transformers runtime exposes the first SDXL text encoder without a
`text_model.` module prefix. Some SDXL LoRA files still store keys under
`text_encoder.text_model...`. The image-pool SDXL loader now normalizes that
prefix before loading the adapter.

Current loader behavior:

1. Read the LoRA state dict with the SDXL pipeline helper.
2. Pass the loaded SDXL UNet config into Diffusers conversion.
3. Normalize `text_encoder.text_model.` keys when the loaded text encoder does
   not expose a `text_model` module.
4. Load UNet weights only when `unet.` keys exist.
5. Load `text_encoder` weights only when `text_encoder.` keys exist.
6. Load `text_encoder_2` weights only when `text_encoder_2.` keys exist.

This keeps UNet-only, UNet+text, and text-only files on separate code paths.

### Kohya / SGM SDXL LoRAs

The imported `Kandinsky` LoRA is a real SDXL Kohya/SGM file.

Local inspection found:

| Field | Value |
| --- | --- |
| Imported id | `imported/kandinsky` |
| Format guess | `kohya-sgm` |
| Family guess | `sdxl` |
| Confidence | about `0.85` |
| Metadata architecture | `stable-diffusion-xl-v1-base/lora` |
| Metadata implementation | `https://github.com/Stability-AI/generative-models` |
| Metadata base version | `sdxl_base_v1-0` |
| Metadata resolution | `1024x1024` |
| Components | `unet`, `text_encoder`, `text_encoder_2` |

The first load attempt failed because Diffusers converted the SGM key layout
without the local SDXL UNet config. That produced invalid SDXL block mappings,
such as non-existing block indices.

The current SDXL loader fixes this by calling the pipeline helper with:

```python
unet_config=self._pipe.unet.config
```

That keeps conversion runtime-only. The imported `.safetensors` file is not
modified.

Live validation:

| Path | Result |
| --- | --- |
| Direct image-pool request with `imported/kandinsky` | HTTP `200`; metrics showed `lora_id=imported/kandinsky` and `lora_scale=1.0`. |
| Direct image-pool request without LoRA after that | HTTP `200`; metrics showed empty `lora_id` and `lora_scale=0.0`. |
| Workbench proxy request with `imported/kandinsky` | HTTP `200`; metrics showed the LoRA was active. |

Prompt-level check:

```text
Kandinsky Amsterdam
```

With the LoRA, the output moved strongly toward abstract Kandinsky-like visual
language. Without the LoRA, SDXL kept more of the Amsterdam scene and only
picked up style from the prompt. This confirms the adapter has a visible effect,
not only a successful load.

### SD 1.5 LoRAs Are a Separate Family

The imported `kandinsky-v1` file is not the same case as `Kandinsky`.

Local inspection found:

| Field | Value |
| --- | --- |
| Imported id | `imported/kandinsky-v1` |
| Format guess | `kohya` |
| Family guess | `sd15` |
| Confidence | about `0.55` |
| Metadata | none found |
| Text encoder key prefix | `lora_te_` |
| SDXL text encoder markers | no `lora_te1_`, no `lora_te2_`, no `text_encoder_2` |

The SDXL loader should not try to make this work by pretending it is SDXL.
ComfyUI-style loaders can try to map a LoRA to the current model and report
missing or unloaded keys, but that is not real compatibility.

The better path is native support per family:

- SDXL LoRAs load on SDXL models.
- SD 1.5 LoRAs load on SD 1.5 models when image-pool has an SD 1.5 runtime.
- Imported metadata can warn about likely mismatches, but live load/generation
  remains the final compatibility check.

### Format, Family, and Compatibility

The LoRA library now separates three ideas:

| Concept | Meaning |
| --- | --- |
| Format | How the tensor keys are stored, for example Diffusers, Kohya, or Kohya/SGM. |
| Family | Which base model family the LoRA probably belongs to, for example SDXL or SD 1.5. |
| Configured compatibility | Which image-pool model ids the user selected during import. |

These can disagree.

Useful signals:

- `modelspec.architecture` and `ss_base_model_version` are strong signals when
  present.
- `lora_te1_` and `lora_te2_` point to SDXL.
- `lora_te_` without SDXL text-encoder-2 markers points toward SD 1.5.
- Metadata is often missing on Civitai-style files, so inspection must stay
  best-effort.

The UI should continue to show both configured and detected family. A mismatch
is useful information before generation fails or produces no visible effect.

### Textual Inversion Embeddings

Some SDXL training workflows produce two artifacts:

```text
<name>.safetensors
<name>_emb.safetensors
```

The first file is the LoRA. The second file is a textual-inversion embedding.
The embedding teaches new prompt tokens such as `<s0><s1>`.

Current workbench/image-pool import stores one `.safetensors` file per imported
LoRA. That means the LoRA part of `weasley24/dnd-SDXL-LoRA` can be imported and
loaded, but the companion embedding is ignored. Prompts that rely on inserted
tokens may still work as ordinary text, but they do not get the trained token
embedding.

Supporting this properly needs a small extension to the LoRA library/import
model:

- allow an optional embedding file next to the LoRA file.
- store embedding metadata and token names.
- load the embedding into both SDXL text encoders before generation.
- show in the UI whether an imported LoRA needs a companion embedding.

### Local Test Artifacts

Downloaded files:

```text
/home/gunnar/Downloads/sdxl-loras/cartoon.safetensors
/home/gunnar/Downloads/sdxl-loras/test-cases/Archana99__sdxl-lora-sketch-testing/pytorch_lora_weights.safetensors
/home/gunnar/Downloads/sdxl-loras/test-cases/jonknownothing__sdxl-lora-advanced-2/pytorch_lora_weights.safetensors
/home/gunnar/Downloads/sdxl-loras/test-cases/weasley24__dnd-SDXL-LoRA/dnd-SDXL-LoRA.safetensors
/home/gunnar/Downloads/sdxl-loras/test-cases/weasley24__dnd-SDXL-LoRA/dnd-SDXL-LoRA_emb.safetensors
/home/gunnar/Downloads/sdxl-loras/test-cases/local-derived/sketch-text-encoders-only.safetensors
```

Imported LoRA ids:

```text
imported/cartoon
imported/kandinsky
imported/kandinsky-v1
imported/sdxl-sketch-te-test
imported/sdxl-advanced2-te-test
imported/sdxl-dnd-embedding-test
imported/sdxl-text-encoders-only-test
```

Generated validation images:

```text
/tmp/sdxl-kandinsky-lora.png
/tmp/workbench-sdxl-kandinsky-lora.png
```

Smoke-test contact sheet:

```text
/tmp/sdxl-lora-type-matrix.png
```

References:

- Diffusers LoRA loader docs: <https://huggingface.co/docs/diffusers/api/loaders/lora>
- Cartoon UNet-only LoRA: <https://huggingface.co/ntc-ai/SDXL-LoRA-slider.cartoon>
- Sketch UNet+text LoRA: <https://huggingface.co/Archana99/sdxl-lora-sketch-testing>
- Advanced DreamBooth UNet+text LoRA: <https://huggingface.co/jonknownothing/sdxl-lora-advanced-2>
- DND LoRA plus embedding example: <https://huggingface.co/weasley24/dnd-SDXL-LoRA>

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
8. Add SD 1.5 model/runtime support before trying to use SD 1.5 LoRAs such as
   `imported/kandinsky-v1`.
9. Add optional textual-inversion embedding import for SDXL LoRAs that ship a
   companion embedding file.
10. Test more Civitai SDXL Kohya/SGM LoRAs now that `imported/kandinsky` works.

## Open Questions

- Is `z-image-base -> z-image-turbo` LoRA transfer good enough, or should Turbo
  always be trained with the Turbo adapter?
- Is `1.75` a generally useful default or only needed because this run used
  too few steps/rank?
- Does a checkpoint before step `1000` look better than the final checkpoint?
- Should the UI default LoRA scale be model-specific, LoRA-specific, or both?
- Should imported LoRAs get an explicit compatibility probe button that attempts
  a load against a selected model before the user generates an image?
- Should SDXL LoRA import allow a companion embedding file in the same flow, or
  should embeddings become a separate library item?
