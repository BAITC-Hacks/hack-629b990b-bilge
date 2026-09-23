# Local Avatar API

Sidecar FastAPI service for local Hunyuan3D avatar generation.

Base URL (development): `http://localhost:8001`

The Node.js BFF does **not** host this API. Call it directly from the frontend, or proxy it later if you want a same-origin URL.

CORS is restricted to configured local origins (see `LOCAL_AVATAR_CORS_ORIGINS`).

## Health

`GET http://localhost:8001/health`

Example:

```json
{
  "status": "ok",
  "backend": "hunyuan3d",
  "device": "cuda:0",
  "modelLoaded": true
}
```

`modelLoaded` is `false` until the first generation loads weights (lazy load).

If the engine cannot start:

```json
{
  "status": "error",
  "backend": "none",
  "device": "unknown",
  "modelLoaded": false
}
```

## Create generation job

`POST http://localhost:8001/api/avatar/jobs`

`multipart/form-data`:

- `image` (required): JPEG / PNG / WEBP
- `userId` (optional): defaults to `demo-user-1`

Example response:

```json
{
  "jobId": "abc123",
  "status": "queued"
}
```

The photo is written to a generated temp filename, processed locally, then deleted after the job finishes. The original file on disk is never modified.

If another generation is already running, the service returns HTTP 409:

```json
{ "detail": "Avatar engine is currently processing another avatar." }
```

## Poll generation

`GET http://localhost:8001/api/avatar/jobs/{jobId}`

Example:

```json
{
  "jobId": "abc123",
  "status": "processing",
  "stage": "reconstructing_human",
  "message": "Reconstructing your 3D identity...",
  "backend": "hunyuan3d",
  "modelUrl": null,
  "error": null
}
```

Completed:

```json
{
  "jobId": "abc123",
  "status": "completed",
  "stage": "completed",
  "message": "3D Identity Ready",
  "backend": "hunyuan3d",
  "modelUrl": "http://localhost:8001/generated/avatar-abc123.glb",
  "error": null
}
```

Failed:

```json
{
  "jobId": "abc123",
  "status": "failed",
  "stage": "failed",
  "backend": "hunyuan3d",
  "modelUrl": null,
  "error": "We couldn't build a 3D avatar from this photo."
}
```

Poll every 1–2 seconds until `completed` or `failed`. Stop polling when the UI unmounts.

Coarse stages:

- `queued`
- `validating_image`
- `loading_model`
- `reconstructing_human`
- `building_mesh`
- `exporting_glb`
- `completed` / `failed`

These are real stages, not fake percentages.

## Generated GLB

`GET http://localhost:8001/generated/{filename}.glb`

Only files matching `avatar-*.glb` style generated names (safe filename regex) are served. Arbitrary filesystem paths are not exposed.

Use the `modelUrl` from the completed job directly:

```html
<model-viewer src="http://localhost:8001/generated/avatar-abc123.glb" camera-controls></model-viewer>
```

The same URL works with Three.js / React Three Fiber GLTF loaders. The model server sends CORS headers for the configured local frontend origins.

## Optional sync test endpoint

`POST http://localhost:8001/api/avatar/generate-sync`

Same multipart fields as job create. Blocks until the job finishes (up to 15 minutes) and returns the same job JSON. Use for local debugging only. The product UI should keep using the jobs API.

## Persistence contract (frontend)

After `status === "completed"` and `modelUrl` is present, store metadata only:

```json
{
  "provider": "local",
  "backend": "hunyuan3d",
  "modelUrl": "http://localhost:8001/generated/avatar-abc123.glb",
  "createdAt": "...",
  "updatedAt": "..."
}
```

Do not store the source selfie in `localStorage` or `public/`. Keep the previous avatar until a new job completes successfully.

## Privacy

- Photo is sent only to this local service
- No Avaturn / MetaPerson / Ready Player Me / hosted inference
- Temporary upload is deleted after the job
- Model weights stay in the local Hugging Face cache, not in git
