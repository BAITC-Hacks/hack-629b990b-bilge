from pathlib import Path

from app.models.base import AvatarBackend, AvatarBackendError, BackendHealth
from app.schemas.jobs import AvatarGenerationResult

PIXIE_BLOCKER = (
    "PIXIE cannot run on this machine: official stack targets Python 3.7 + PyTorch 1.6, "
    "and SMPL-X body models are not present. Those weights require a separate MPI/SMPL-X "
    "registration download and cannot be fetched automatically."
)


class PixieAvatarBackend(AvatarBackend):
    name = "pixie"
    kind = "human_smplx"
    human_specific = True

    def __init__(self) -> None:
        raise AvatarBackendError(PIXIE_BLOCKER, user_message="The PIXIE human backend is not available.", code="pixie_unavailable")

    def health(self) -> BackendHealth:
        return BackendHealth(name=self.name, device="unavailable", model_loaded=False, kind=self.kind)

    def generate(self, image_path: Path, output_path: Path, progress=None) -> AvatarGenerationResult:
        raise AvatarBackendError(PIXIE_BLOCKER, user_message="The PIXIE human backend is not available.", code="pixie_unavailable")
