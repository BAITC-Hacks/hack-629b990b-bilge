from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

from app.schemas.jobs import AvatarGenerationResult


class AvatarBackendError(RuntimeError):
    def __init__(self, message: str, *, user_message: Optional[str] = None, code: str = "backend_error"):
        super().__init__(message)
        self.user_message = user_message or message
        self.code = code


@dataclass
class BackendHealth:
    name: str
    device: str
    model_loaded: bool
    gpu: Optional[str] = None
    kind: str = "general_3d_fallback"
    extra: Optional[dict[str, Any]] = None


class AvatarBackend(ABC):
    name: str
    kind: str = "general_3d_fallback"
    human_specific: bool = False

    @abstractmethod
    def health(self) -> BackendHealth:
        raise NotImplementedError

    @abstractmethod
    def generate(
        self,
        image_path: Path,
        output_path: Path,
        progress=None,
    ) -> AvatarGenerationResult:
        raise NotImplementedError
