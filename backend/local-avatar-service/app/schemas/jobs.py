from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

JobStatus = Literal["queued", "processing", "completed", "failed"]


@dataclass
class AvatarGenerationResult:
    backend: str
    model_path: str
    mesh_path: Optional[str] = None
    textured: bool = False
    human_specific: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobRecord:
    job_id: str
    status: JobStatus
    stage: str
    message: str
    backend: str
    user_id: str = "demo-user-1"
    model_url: Optional[str] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_public(self) -> dict[str, Any]:
        return {
            "jobId": self.job_id,
            "status": self.status,
            "stage": self.stage,
            "message": self.message,
            "modelUrl": self.model_url,
            "backend": self.backend,
            "error": self.error,
        }


@dataclass
class HealthResponse:
    status: str
    backend: str
    device: str
    model_loaded: bool
    gpu: Optional[str] = None
    fallback_reason: Optional[str] = None
    kind: str = "general_3d_fallback"
