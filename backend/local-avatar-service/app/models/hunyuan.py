from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Optional

from app.models.base import AvatarBackend, AvatarBackendError, BackendHealth
from app.schemas.jobs import AvatarGenerationResult
from app.services.export_glb import export_trimesh_glb, normalize_mesh
from app.storage.paths import VENDOR_DIR

_VENDOR = VENDOR_DIR / "Hunyuan3D-2"
if _VENDOR.exists() and str(_VENDOR) not in sys.path:
    sys.path.insert(0, str(_VENDOR))

logger = logging.getLogger("local-avatar.hunyuan")

SHAPE_REPO = os.environ.get("HUNYUAN_SHAPE_REPO", "tencent/Hunyuan3D-2mini")
# Turbo official path needs FlashVDM; use the standard mini shape checkpoint only.
SHAPE_SUBFOLDER = os.environ.get("HUNYUAN_SHAPE_SUBFOLDER", "hunyuan3d-dit-v2-mini")
ENABLE_PAINT = os.environ.get("HUNYUAN_ENABLE_PAINT", "0") == "1"


def _device_label() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return f"cuda:{torch.cuda.current_device()}"
        return "cpu"
    except Exception:
        return "unknown"


def _gpu_name() -> Optional[str]:
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.get_device_name(0)
    except Exception:
        return None
    return None


class HunyuanAvatarBackend(AvatarBackend):
    """Official local Hunyuan3D-2mini shape-only backend.

    Internally labeled general_3d_fallback: this is image-to-3D, not SMPL-X.
    Texture/paint is disabled until the shape-only product path is proven.
    """

    name = "hunyuan3d"
    kind = "general_3d_fallback"
    human_specific = False

    def __init__(self) -> None:
        try:
            import torch  # noqa: F401
            from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline  # noqa: F401
        except Exception as exc:
            raise AvatarBackendError(
                f"Hunyuan3D local code is not importable: {exc}",
                user_message="The local 3D engine is not installed.",
                code="hunyuan_missing",
            ) from exc

        if _device_label() == "cpu":
            raise AvatarBackendError(
                "Hunyuan3D requires a CUDA GPU on this machine.",
                user_message="The local avatar engine needs a CUDA GPU.",
                code="cuda_required",
            )

        self._shape = None
        self._paint = None
        self._rembg = None
        self._paint_failed: Optional[str] = "disabled: shape-only P0"

    def health(self) -> BackendHealth:
        return BackendHealth(
            name=self.name,
            device=_device_label(),
            model_loaded=self._shape is not None,
            gpu=_gpu_name(),
            kind=self.kind,
            extra={"textureAvailable": self._paint is not None, "textureError": self._paint_failed},
        )

    def _ensure_shape(self, progress=None) -> None:
        if self._shape is not None:
            return
        if progress:
            progress("loading_model", "Loading the local 3D reconstruction model...")
        from hy3dgen.shapegen import Hunyuan3DDiTFlowMatchingPipeline

        self._shape = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(
            SHAPE_REPO,
            subfolder=SHAPE_SUBFOLDER,
            use_safetensors=True,
            variant="fp16",
            device="cuda",
        )

    def _ensure_paint(self) -> None:
        if not ENABLE_PAINT:
            self._paint = None
            self._paint_failed = "disabled: shape-only P0"
            return
        if self._paint is not None or self._paint_failed:
            return
        self._paint_failed = "disabled: shape-only P0"

    def _prepare_image(self, image_path: Path):
        from PIL import Image

        # P0: skip rembg. Its default BRIA model is a 1GB download and blocks first inference.
        image = Image.open(image_path).convert("RGBA")
        logger.info("Using original photo without rembg (shape-only P0)")
        return image

    def generate(self, image_path: Path, output_path: Path, progress=None) -> AvatarGenerationResult:
        import torch

        self._ensure_shape(progress)
        if progress:
            progress("reconstructing_human", "Reconstructing your 3D identity...")

        image = self._prepare_image(image_path)
        try:
            mesh = self._shape(
                image=image,
                num_inference_steps=30,
                octree_resolution=380,
                num_chunks=20000,
                generator=torch.manual_seed(12345),
                output_type="trimesh",
            )[0]
        except torch.cuda.OutOfMemoryError as exc:
            torch.cuda.empty_cache()
            raise AvatarBackendError(
                f"CUDA OOM during Hunyuan3D shape generation: {exc}",
                user_message="The local avatar engine ran out of GPU memory.",
                code="cuda_oom",
            ) from exc
        except Exception as exc:
            raise AvatarBackendError(
                f"Hunyuan3D reconstruction failed: {exc}",
                user_message="We couldn't build a 3D avatar from this photo.",
                code="reconstruction_failed",
            ) from exc

        textured = False
        if progress:
            progress("building_mesh", "Building your avatar...")

        if progress:
            progress("exporting_glb", "Preparing 3D model...")
        try:
            mesh = normalize_mesh(mesh)
            export_trimesh_glb(mesh, output_path)
        except Exception as exc:
            raise AvatarBackendError(
                f"GLB export failed: {exc}",
                user_message="The 3D model could not be exported.",
                code="export_failed",
            ) from exc

        return AvatarGenerationResult(
            backend=self.name,
            model_path=str(output_path),
            mesh_path=str(output_path),
            textured=textured,
            human_specific=False,
            metadata={
                "shapeRepo": SHAPE_REPO,
                "shapeSubfolder": SHAPE_SUBFOLDER,
                "kind": self.kind,
                "textured": False,
            },
        )
