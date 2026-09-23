from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

logger = logging.getLogger("local-avatar.preprocess")

HUMAN_SESSIONS = ("u2net_human_seg", "u2netp", "u2net")


@dataclass
class IsolatedPerson:
    image: Image.Image
    model_name: str
    bbox: tuple[int, int, int, int]


def isolate_person(image_path: Path) -> IsolatedPerson:
    source = Image.open(image_path).convert("RGBA")
    cutout, model_name = _remove_background(source)
    cleaned = _keep_largest_alpha_blob(cutout)
    cropped = _crop_and_center(cleaned, margin=0.06)
    if cropped.getbbox() is None:
        raise ValueError("No person was found in this photo.")
    bbox = cropped.getbbox() or (0, 0, cropped.width, cropped.height)
    logger.info("Isolated person with %s, size=%sx%s", model_name, cropped.width, cropped.height)
    return IsolatedPerson(image=cropped, model_name=model_name, bbox=bbox)


def _remove_background(image: Image.Image) -> tuple[Image.Image, str]:
    from rembg import new_session, remove

    last_error: Exception | None = None
    for name in HUMAN_SESSIONS:
        try:
            session = new_session(name)
            result = remove(image, session=session, bgcolor=[0, 0, 0, 0])
            if result.mode != "RGBA":
                result = result.convert("RGBA")
            alpha = np.array(result.split()[-1])
            if int((alpha > 16).sum()) < 200:
                last_error = RuntimeError(f"{name} produced an empty mask")
                continue
            return result, name
        except Exception as exc:
            last_error = exc
            logger.warning("Background removal with %s failed: %s", name, exc)
    raise RuntimeError(f"Could not isolate the person: {last_error}")


def _keep_largest_alpha_blob(image: Image.Image) -> Image.Image:
    from scipy import ndimage

    arr = np.array(image)
    mask = arr[:, :, 3] > 24
    labeled, count = ndimage.label(mask)
    if count == 0:
        return image
    sizes = ndimage.sum(mask, labeled, range(1, count + 1))
    keep = int(np.argmax(sizes)) + 1
    keep_mask = labeled == keep
    arr[~keep_mask, 3] = 0
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def _crop_and_center(image: Image.Image, margin: float = 0.06) -> Image.Image:
    bbox = image.getbbox()
    if bbox is None:
        return image
    left, top, right, bottom = bbox
    width = right - left
    height = bottom - top
    pad_x = max(8, int(width * margin))
    pad_y = max(8, int(height * margin))
    left = max(0, left - pad_x)
    top = max(0, top - pad_y)
    right = min(image.width, right + pad_x)
    bottom = min(image.height, bottom + pad_y)
    cropped = image.crop((left, top, right, bottom))

    side = max(cropped.width, cropped.height)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    ox = (side - cropped.width) // 2
    oy = (side - cropped.height) // 2
    canvas.paste(cropped, (ox, oy), cropped)
    return canvas
