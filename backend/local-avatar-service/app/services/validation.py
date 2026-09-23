from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = 12 * 1024 * 1024
MIN_DIM = 64
MAX_DIM = 4096
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}
ALLOWED_SUFFIX = {".jpg", ".jpeg", ".png", ".webp"}


class ImageValidationError(ValueError):
    def __init__(self, message: str):
        super().__init__(message)
        self.user_message = message


@dataclass
class ValidatedImage:
    path: Path
    width: int
    height: int
    format: str


def validate_and_save(upload, dest: Path) -> ValidatedImage:
    filename = (getattr(upload, "filename", "") or "").lower()
    suffix = Path(filename).suffix
    if suffix and suffix not in ALLOWED_SUFFIX:
        raise ImageValidationError("Use a JPEG, PNG, or WEBP photo.")

    dest.parent.mkdir(parents=True, exist_ok=True)
    with dest.open("wb") as handle:
        size = 0
        while True:
            chunk = upload.file.read(1024 * 64)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                dest.unlink(missing_ok=True)
                raise ImageValidationError("That photo is too large. Use an image under 12 MB.")
            handle.write(chunk)

    if size < 32:
        dest.unlink(missing_ok=True)
        raise ImageValidationError("The photo file is empty or unreadable.")

    try:
        with Image.open(dest) as image:
            image.verify()
        with Image.open(dest) as image:
            image.load()
            width, height = image.size
            fmt = (image.format or "").upper()
    except (UnidentifiedImageError, OSError) as exc:
        dest.unlink(missing_ok=True)
        raise ImageValidationError("We couldn't read that photo. Try a clearer JPEG or PNG.") from exc

    if fmt not in ALLOWED_FORMATS:
        dest.unlink(missing_ok=True)
        raise ImageValidationError("Use a JPEG, PNG, or WEBP photo.")
    if width < MIN_DIM or height < MIN_DIM:
        dest.unlink(missing_ok=True)
        raise ImageValidationError("Try a clearer front-facing photo.")
    if width > MAX_DIM or height > MAX_DIM:
        dest.unlink(missing_ok=True)
        raise ImageValidationError("That image is too large. Try a smaller photo.")

    return ValidatedImage(path=dest, width=width, height=height, format=fmt)
