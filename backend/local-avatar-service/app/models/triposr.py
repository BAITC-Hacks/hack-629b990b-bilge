from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Optional

from app.models.base import AvatarBackend, AvatarBackendError, BackendHealth
from app.schemas.jobs import AvatarGenerationResult
from app.services.export_glb import export_trimesh_glb, normalize_mesh

logger = logging.getLogger("local-avatar.triposr")

TRIPOSR_WEIGHTS = os.environ.get("TRIPOSR_WEIGHTS", "stabilityai/TripoSR")


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


class TripoSRAvatarBackend(AvatarBackend):
    name = "triposr"
    kind = "general_3d_fallback"
    human_specific = False

    def __init__(self) -> None:
        try:
            from tsr.system import TSR  # noqa: F401
        except Exception as exc:
            raise AvatarBackendError(
                f"TripoSR is not importable: {exc}",
                user_message="The emergency 3D backend is not installed.",
                code="triposr_missing",
            ) from exc
        self._model = None

    def health(self) -> BackendHealth:
        return BackendHealth(
            name=self.name,
            device=_device_label(),
            model_loaded=self._model is not None,
            gpu=_gpu_name(),
            kind=self.kind,
        )

    def _ensure(self, progress=None) -> None:
        if self._model is not None:
            return
        if progress:
            progress("loading_model", "Loading the local 3D reconstruction model...")
        import torch
        from tsr.system import TSR

        device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model = TSR.from_pretrained(
            TRIPOSR_WEIGHTS,
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        self._model.to(device)

    def generate(self, image_path: Path, output_path: Path, progress=None) -> AvatarGenerationResult:
        import numpy as np
        import torch
        from PIL import Image

        self._ensure(progress)
        if progress:
            progress("reconstructing_human", "Reconstructing your 3D identity...")

        image = Image.open(image_path).convert("RGB")
        try:
            with torch.no_grad():
                scene_codes = self._model([image], device=next(self._model.parameters()).device)
                meshes = self._model.extract_mesh(scene_codes, resolution=256)
            mesh = meshes[0]
            if isinstance(mesh, tuple):
                verts, faces = mesh[0], mesh[1]
                import trimesh

                mesh = trimesh.Trimesh(vertices=np.asarray(verts), faces=np.asarray(faces), process=False)
        except torch.cuda.OutOfMemoryError as exc:
            torch.cuda.empty_cache()
            raise AvatarBackendError(
                f"CUDA OOM during TripoSR: {exc}",
                user_message="The local avatar engine ran out of GPU memory.",
                code="cuda_oom",
            ) from exc
        except Exception as exc:
            raise AvatarBackendError(
                f"TripoSR reconstruction failed: {exc}",
                user_message="We couldn't build a 3D avatar from this photo.",
                code="reconstruction_failed",
            ) from exc

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
            textured=False,
            human_specific=False,
            metadata={"weights": TRIPOSR_WEIGHTS, "kind": self.kind},
        )
