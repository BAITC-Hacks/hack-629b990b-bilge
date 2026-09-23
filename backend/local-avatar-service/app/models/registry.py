from __future__ import annotations

import logging
import os
from typing import Optional

from app.models.base import AvatarBackend, AvatarBackendError

logger = logging.getLogger("local-avatar.registry")

PREFERRED = ("hunyuan3d",)


def _construct(name: str) -> AvatarBackend:
    if name == "pixie":
        from app.models.pixie import PixieAvatarBackend

        return PixieAvatarBackend()
    if name in {"hunyuan3d", "hunyuan", "hunyuan3d-2", "hunyuan3d-2mini"}:
        from app.models.hunyuan import HunyuanAvatarBackend

        return HunyuanAvatarBackend()
    if name == "triposr":
        from app.models.triposr import TripoSRAvatarBackend

        return TripoSRAvatarBackend()
    raise AvatarBackendError(
        f"Unknown LOCAL_AVATAR_BACKEND={name}",
        user_message="The local avatar engine is not configured.",
        code="unknown_backend",
    )


def select_backend(requested: Optional[str] = None) -> tuple[AvatarBackend, Optional[str]]:
    requested = (requested or os.environ.get("LOCAL_AVATAR_BACKEND") or "hunyuan3d").strip().lower()
    attempts: list[str] = []
    fallback_notes: list[str] = []

    if requested == "auto":
        order = list(PREFERRED)
    else:
        order = [requested] + [name for name in PREFERRED if name != requested]

    last_error: Optional[Exception] = None
    for name in order:
        try:
            backend = _construct(name)
            note = None
            if attempts:
                note = " | ".join(fallback_notes)
            if requested not in {"auto", name} and name != requested:
                note = f"Requested {requested} failed; using {name}. " + (note or "")
            logger.info("Active local avatar backend: %s", backend.name)
            return backend, note
        except Exception as exc:
            last_error = exc
            attempts.append(name)
            fallback_notes.append(f"{name}: {exc}")
            logger.warning("Backend %s unavailable: %s", name, exc)

    raise AvatarBackendError(
        f"No local avatar backend could start. {fallback_notes}",
        user_message="The local avatar engine is not available.",
        code="no_backend",
    ) from last_error
