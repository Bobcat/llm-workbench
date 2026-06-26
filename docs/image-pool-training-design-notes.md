# Image Pool Training Design Notes

Status: draft.

## Working Assumptions

- One image-pool instance represents one GPU workbench.
- The current target is one user per image-pool instance.
- Multiple datasets must be possible in the same image-pool environment.
- Only one training run should be active at a time, because training saturates the GPU.
- Multi-user accounts, permissions, and GPU scheduling are out of scope for now.

## Dataset Model

Training should use persistent server-side dataset projects, not browser-only uploads.

Example layout:

```text
data/image_pool/training/datasets/
  scorpion-study/
    dataset.json
    manifest.json
    images/
    captions/

  product-packshots/
    dataset.json
    manifest.json
    images/
    captions/
```

The server-side dataset is the source used for captioning, preflight checks, training, and later export. A user can work on a dataset over multiple sessions without uploading everything again.

## Import And Sync

The UI should support several dataset sources:

- Sync local folder
- Upload zip or folder
- Import server directory
- Download sample dataset

The existing BFL tutorial download should become "Download Sample Dataset", not the primary workflow.

For local folder sync, the browser can send a file manifest first:

```text
relative_path
filename
size
modified_time
hash if available
```

The server compares that manifest with the stored dataset manifest and only uploads new or changed files. Removed local files should be handled explicitly, not silently deleted from the server copy.

The server dataset name can be suggested from the local folder name, for example:

```text
/Users/sanne/Pictures/scorpion-style -> scorpion-style
```

If the slug exists, propose a suffix such as `scorpion-style-2`.

## Training Runs

Training should reference a dataset id/path and capture the exact dataset state used for the run.

Example layout:

```text
data/image_pool/training/runs/
  scorpion-study/
    20260626-180650/
      request.json
      train.log
      pytorch_lora_weights.safetensors
      checkpoints/
        step-000500/
        step-001000/
```

At training start, record a snapshot manifest so the run remains reproducible even if the dataset is later synced again.

## Export And Restore

Future export/restore should be straightforward if all artifacts live under `data/image_pool/training/`.

Useful future actions:

- Download Dataset Bundle: images, captions, dataset metadata.
- Download Run Bundle: LoRA, checkpoints, config, logs.
- Download Workspace Bundle: all datasets and runs before releasing a rented GPU.
- Restore Bundle: upload a previous bundle into a fresh image-pool instance.

This is intentionally not implemented yet. The current goal is to keep paths and ids clean enough that export/restore can be added later without moving artifacts around.

## UI Shape

Dataset Preparation:

- Dataset picker
- New dataset
- Sync local folder
- Import zip/folder
- Import server directory
- Download sample dataset
- Caption dataset
- Dataset health/preflight

Training:

- Select dataset
- Select model
- Configure params
- Start training
- Monitor progress
- Inspect checkpoints
- Load/test LoRA
