# Local Avatar Service

Python FastAPI sidecar for KodeClubs-style 3D avatar generation.

It does **not** replace the Node.js BFF in `backend/src`. Run this service separately on port 8001.

## What it does

Local full-body image → person isolation → local Hunyuan3D → visibility-aware texture bake → GLB.

No external avatar SaaS.

```
Browser / Node BFF
  → http://127.0.0.1:8001
  → FastAPI job API
  → rembg person isolation
  → Hunyuan3D-2mini shape pipeline (local GPU)
  → visibility-aware front texture bake
  → generated/*.glb
  → model-viewer / Three.js
```

## Current status

- API implemented (`/health`, job create/poll, generated GLB serving, optional sync test endpoint)
- Hunyuan integration implemented (local shape wrapper)
- Person isolation with rembg `u2net_human_seg` (largest foreground component, crop + center)
- Mesh cleanup keeps the main body and drops tiny disconnected junk
- Visibility-aware coloring: front-visible faces sample the isolated photo; back / occluded faces use region colors
- Hunyuan3D-Paint remains **disabled** (`HUNYUAN_ENABLE_PAINT=0`) — this is not photorealistic multi-view texturing
- First local generation **validated** on an RTX 4090 with a full-body photo
- Generated GLBs are **not** stored in git

## Privacy

- Generation happens locally on the machine that runs this service
- The photo is sent only to `localhost` (this FastAPI process)
- No Avaturn
- No MetaPerson
- No Ready Player Me
- No hosted inference API
- Temporary uploads are deleted after the job finishes
- Original user photos are never overwritten

## Model weights

**MODEL WEIGHTS ARE NOT STORED IN GIT.**

Do not commit:

- Hugging Face caches
- Hunyuan checkpoints
- rembg ONNX files
- generated GLBs
- uploaded photos

Weights download into the local Hugging Face cache on first run.

## Hugging Face

Login may be required to download official Hunyuan weights:

```bash
hf auth login
```

Do **not** put the token in this repository or in `.env` files that get committed.

## Setup

Tested with:

- Python 3.11
- PyTorch 2.11 + CUDA 12.8
- NVIDIA GPU (RTX 4090 in the original hackathon environment)

```bash
cd backend/local-avatar-service
python3.11 -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r requirements.txt

# Official Hunyuan3D-2 code — clone beside the service, do not commit it
git clone --depth 1 https://github.com/Tencent/Hunyuan3D-2.git vendor/Hunyuan3D-2
pip install -e vendor/Hunyuan3D-2
# plus Hunyuan shape-runtime deps (diffusers, transformers, rembg, onnxruntime, ...)
# see vendor/Hunyuan3D-2/requirements.txt — skip Gradio/demo extras if possible
```

The wrapper looks for `vendor/Hunyuan3D-2` and also works if `hy3dgen` is already installed in the environment.

Upstream repository: https://github.com/Tencent/Hunyuan3D-2

Default shape checkpoint: `tencent/Hunyuan3D-2mini` / `hunyuan3d-dit-v2-mini`

Hunyuan3D uses the Tencent Hunyuan 3D 2.0 Community License. It is **not** automatically commercially deployable.

## Running

```bash
cd backend/local-avatar-service
# activate your Python env first
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

Health:

```bash
curl http://127.0.0.1:8001/health
```

## API

See [../../docs/local-avatar-api.md](../../docs/local-avatar-api.md)

TypeScript helper: [../client/avatar.ts](../client/avatar.ts)

## Generated files

- Temporary uploads: `tmp/` (deleted after each job)
- Generated GLBs: `generated/` (kept on disk, not in git)
