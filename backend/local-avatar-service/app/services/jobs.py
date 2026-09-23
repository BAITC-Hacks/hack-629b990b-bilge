from __future__ import annotations

import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from app.models.base import AvatarBackend, AvatarBackendError
from app.schemas.jobs import JobRecord
from app.storage.paths import GENERATED_DIR, TMP_DIR, ensure_dirs

logger = logging.getLogger("local-avatar.jobs")

FRIENDLY = {
    "queued": "Waiting for the local avatar engine...",
    "validating_image": "Reading your photo...",
    "loading_model": "Loading the local 3D reconstruction model...",
    "reconstructing_human": "Reconstructing your 3D identity...",
    "building_mesh": "Building your avatar...",
    "exporting_glb": "Preparing 3D model...",
    "completed": "3D Identity Ready",
    "failed": "Avatar generation failed",
}


class JobManager:
    def __init__(self, backend: AvatarBackend, public_origin: str):
        ensure_dirs()
        self.backend = backend
        self.public_origin = public_origin.rstrip("/")
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.Lock()
        self._worker_lock = threading.Lock()
        self._busy = False

    def get(self, job_id: str) -> Optional[JobRecord]:
        return self._jobs.get(job_id)

    def is_busy(self) -> bool:
        return self._busy

    def create(self, image_path: Path, user_id: str) -> JobRecord:
        job_id = uuid.uuid4().hex
        record = JobRecord(
            job_id=job_id,
            status="queued",
            stage="queued",
            message=FRIENDLY["queued"],
            backend=self.backend.name,
            user_id=user_id,
        )
        self._jobs[job_id] = record
        threading.Thread(target=self._run, args=(job_id, image_path), daemon=True).start()
        return record

    def _update(self, job_id: str, **fields) -> None:
        record = self._jobs[job_id]
        for key, value in fields.items():
            setattr(record, key, value)
        record.updated_at = datetime.now(timezone.utc).isoformat()

    def _progress(self, job_id: str) -> Callable[[str, str], None]:
        def report(stage: str, message: Optional[str] = None) -> None:
            self._update(
                job_id,
                status="processing",
                stage=stage,
                message=message or FRIENDLY.get(stage, stage),
            )

        return report

    def _run(self, job_id: str, image_path: Path) -> None:
        acquired = self._worker_lock.acquire(timeout=0.05)
        if not acquired:
            self._update(
                job_id,
                status="failed",
                stage="failed",
                error="Avatar engine is currently processing another avatar.",
                message="Avatar engine is currently processing another avatar.",
            )
            delete_temp(image_path)
            return

        self._busy = True
        output_path = GENERATED_DIR / f"avatar-{job_id}.glb"
        try:
            self._update(job_id, status="processing", stage="validating_image", message=FRIENDLY["validating_image"])
            result = self.backend.generate(image_path, output_path, progress=self._progress(job_id))
            model_url = f"{self.public_origin}/generated/{output_path.name}"
            self._update(
                job_id,
                status="completed",
                stage="completed",
                message=FRIENDLY["completed"],
                model_url=model_url,
                backend=result.backend,
                error=None,
            )
        except AvatarBackendError as exc:
            logger.exception("Avatar job %s failed", job_id)
            self._update(
                job_id,
                status="failed",
                stage="failed",
                error=exc.user_message,
                message=exc.user_message,
            )
            delete_generated(output_path)
        except Exception:
            logger.exception("Avatar job %s crashed", job_id)
            self._update(
                job_id,
                status="failed",
                stage="failed",
                error="We couldn't build a 3D avatar from this photo.",
                message="We couldn't build a 3D avatar from this photo.",
            )
            delete_generated(output_path)
        finally:
            delete_temp(image_path)
            self._busy = False
            self._worker_lock.release()


def delete_temp(path: Path) -> None:
    try:
        resolved = path.resolve()
        if resolved.is_relative_to(TMP_DIR.resolve()):
            path.unlink(missing_ok=True)
    except Exception:
        logger.warning("Could not delete temporary upload %s", path)


def delete_generated(path: Path) -> None:
    try:
        resolved = path.resolve()
        if resolved.is_relative_to(GENERATED_DIR.resolve()) and resolved.suffix == ".glb":
            path.unlink(missing_ok=True)
    except Exception:
        logger.warning("Could not delete failed GLB %s", path)
