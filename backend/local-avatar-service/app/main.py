from __future__ import annotations

import logging
import os
import re
import time

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from app.models.base import AvatarBackendError
from app.models.registry import select_backend
from app.services.jobs import JobManager
from app.services.validation import ImageValidationError, validate_and_save
from app.storage.paths import GENERATED_DIR, TMP_DIR, ensure_dirs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("local-avatar")

load_dotenv()
ensure_dirs()

PUBLIC_ORIGIN = os.environ.get("LOCAL_AVATAR_PUBLIC_ORIGIN", "http://localhost:8001")
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "LOCAL_AVATAR_CORS_ORIGINS",
        "http://localhost:3010,http://127.0.0.1:3010",
    ).split(",")
    if origin.strip()
]

FALLBACK_NOTE = None
try:
    BACKEND, FALLBACK_NOTE = select_backend()
except AvatarBackendError as exc:
    logger.error("No avatar backend available: %s", exc)
    BACKEND = None
    FALLBACK_NOTE = str(exc)

jobs = JobManager(BACKEND, PUBLIC_ORIGIN) if BACKEND else None

app = FastAPI(title="KodeClubs Local Avatar Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
@app.get("/health")
def health() -> dict:
    if BACKEND is None:
        return {
            "status": "error",
            "backend": "none",
            "device": "unknown",
            "modelLoaded": False,
            "gpu": None,
            "kind": None,
            "fallbackReason": FALLBACK_NOTE,
        }
    info = BACKEND.health()
    return {
        "status": "ok",
        "backend": info.name,
        "device": info.device,
        "modelLoaded": info.model_loaded,
        "gpu": info.gpu,
        "kind": info.kind,
        "fallbackReason": FALLBACK_NOTE,
    }


@app.post("/api/avatar/jobs")
async def create_job(
    image: UploadFile = File(...),
    userId: str = Form("demo-user-1"),
):
    if BACKEND is None or jobs is None:
        raise HTTPException(status_code=503, detail="Avatar engine is offline.")
    if jobs.is_busy():
        raise HTTPException(status_code=409, detail="Avatar engine is currently processing another avatar.")

    safe_user = re.sub(r"[^a-zA-Z0-9_-]", "", userId or "demo-user-1")[:64] or "demo-user-1"
    temp_name = f"upload-{os.urandom(16).hex()}.img"
    temp_path = TMP_DIR / temp_name
    try:
        validate_and_save(image, temp_path)
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.user_message) from exc

    record = jobs.create(temp_path, safe_user)
    return {"jobId": record.job_id, "status": record.status}


@app.get("/api/avatar/jobs/{job_id}")
def get_job(job_id: str):
    if jobs is None:
        raise HTTPException(status_code=503, detail="Avatar engine is offline.")
    if not re.fullmatch(r"[a-f0-9]{16,64}", job_id):
        raise HTTPException(status_code=404, detail="Job not found.")
    record = jobs.get(job_id)
    if record is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return record.to_public()


@app.post("/api/avatar/generate-sync")
async def generate_sync(
    image: UploadFile = File(...),
    userId: str = Form("demo-user-1"),
):
    if BACKEND is None or jobs is None:
        raise HTTPException(status_code=503, detail="Avatar engine is offline.")
    if jobs.is_busy():
        raise HTTPException(status_code=409, detail="Avatar engine is currently processing another avatar.")
    safe_user = re.sub(r"[^a-zA-Z0-9_-]", "", userId or "demo-user-1")[:64] or "demo-user-1"
    temp_name = f"upload-{os.urandom(16).hex()}.img"
    temp_path = TMP_DIR / temp_name
    try:
        validate_and_save(image, temp_path)
    except ImageValidationError as exc:
        raise HTTPException(status_code=400, detail=exc.user_message) from exc
    record = jobs.create(temp_path, safe_user)
    deadline = time.time() + 900
    while time.time() < deadline:
        current = jobs.get(record.job_id)
        if current and current.status in {"completed", "failed"}:
            return current.to_public()
        time.sleep(1)
    raise HTTPException(status_code=504, detail="Generation timed out.")


@app.get("/generated/{filename}")
def generated_file(filename: str):
    if not re.fullmatch(r"[A-Za-z0-9._-]+\.glb", filename):
        raise HTTPException(status_code=404, detail="Model not found.")
    path = (GENERATED_DIR / filename).resolve()
    if not path.is_relative_to(GENERATED_DIR.resolve()) or not path.is_file():
        raise HTTPException(status_code=404, detail="Model not found.")
    return FileResponse(path, media_type="model/gltf-binary", filename=filename)
