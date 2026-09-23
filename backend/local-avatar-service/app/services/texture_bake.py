from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from PIL import Image
from scipy import ndimage
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

logger = logging.getLogger("local-avatar.texture")

FRONT_NORMAL_MIN = 0.22
CHART = 1024
GUTTER = 10
UV_PAD = 0.012


@dataclass
class RegionPalette:
    hair: np.ndarray
    skin: np.ndarray
    jacket: np.ndarray
    shirt: np.ndarray
    pants: np.ndarray
    shoes: np.ndarray

    def darkened(self, scale: float = 0.82) -> "RegionPalette":
        def dim(color: np.ndarray) -> np.ndarray:
            return np.clip(color.astype(np.float32) * scale, 0, 255).astype(np.uint8)

        return RegionPalette(
            hair=dim(self.hair),
            skin=dim(self.skin),
            jacket=dim(self.jacket),
            shirt=dim(self.shirt),
            pants=dim(self.pants),
            shoes=dim(self.shoes),
        )


def bake_visible_front_texture(mesh: trimesh.Trimesh, person_image: Image.Image) -> trimesh.Trimesh:
    """Bake front-photo color only onto visible front faces.

    Back-facing and occluded faces get region-consistent fallback colors.
    The front image is never sampled for unseen surfaces.
    """
    scene = _as_mesh(mesh).copy()
    if scene.faces is None or len(scene.faces) == 0:
        raise ValueError("Mesh has no faces to texture")

    try:
        scene.fix_normals()
    except Exception:
        pass

    image = np.asarray(person_image.convert("RGBA"))
    alpha = _eroded_alpha(image)
    content = _content_bbox(alpha)
    palette = estimate_region_palette(image, alpha)
    atlas = _build_atlas(image, alpha, palette, content)

    verts = np.asarray(scene.vertices, dtype=np.float64)
    faces = np.asarray(scene.faces, dtype=np.int64)
    face_normals = _oriented_face_normals(scene)
    photo_faces = _photo_eligible_faces(verts, faces, face_normals, alpha, content)

    textured = _mesh_with_two_chart_uvs(verts, faces, photo_faces, atlas)
    logger.info(
        "Visibility-aware bake: photo faces %s / %s, atlas %sx%s",
        int(photo_faces.sum()),
        len(faces),
        atlas.size[0],
        atlas.size[1],
    )
    return textured


def estimate_region_palette(image: np.ndarray, alpha: np.ndarray | None = None) -> RegionPalette:
    if alpha is None:
        alpha = _eroded_alpha(image)
    ys, xs = np.where(alpha)
    if ys.size < 50:
        fallback = np.array([48, 40, 38], dtype=np.uint8)
        return RegionPalette(fallback, np.array([168, 132, 112], dtype=np.uint8), fallback, fallback, fallback, fallback)

    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    height = max(1, y1 - y0)
    width = max(1, x1 - x0)

    def band(t0: float, t1: float, sx0: float = 0.0, sx1: float = 1.0, dark_pct: float | None = None) -> np.ndarray:
        top = y0 + int(t0 * height)
        bottom = y0 + int(t1 * height)
        left = x0 + int(sx0 * width)
        right = x0 + int(sx1 * width)
        sel = np.zeros_like(alpha)
        sel[top:bottom, left:right] = alpha[top:bottom, left:right]
        pixels = image[sel][:, :3]
        if len(pixels) < 30:
            return np.array([48, 40, 38], dtype=np.uint8)
        if dark_pct is not None:
            luma = pixels.astype(np.float32).mean(axis=1)
            cutoff = np.percentile(luma, dark_pct)
            dark = pixels[luma <= cutoff]
            if len(dark) >= 20:
                pixels = dark
        return np.median(pixels, axis=0).astype(np.uint8)

    jacket_left = band(0.28, 0.56, 0.00, 0.30)
    jacket_right = band(0.28, 0.56, 0.70, 1.00)
    jacket = np.median(np.stack([jacket_left, jacket_right]), axis=0).astype(np.uint8)
    return RegionPalette(
        hair=band(0.00, 0.08, dark_pct=20),
        skin=band(0.11, 0.20, 0.32, 0.68),
        jacket=jacket,
        shirt=band(0.32, 0.50, 0.34, 0.66),
        pants=band(0.58, 0.86),
        shoes=band(0.88, 1.00),
    )


def _content_bbox(alpha: np.ndarray, margin: float = 0.03) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha)
    if ys.size == 0:
        h, w = alpha.shape[:2]
        return 0, 0, w, h
    top, bottom = int(ys.min()), int(ys.max()) + 1
    left, right = int(xs.min()), int(xs.max()) + 1
    height = max(1, bottom - top)
    width = max(1, right - left)
    pad_y = max(2, int(height * margin))
    pad_x = max(2, int(width * margin))
    h, w = alpha.shape[:2]
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(w, right + pad_x),
        min(h, bottom + pad_y),
    )


def _eroded_alpha(image: np.ndarray, threshold: int = 40, iterations: int = 4) -> np.ndarray:
    raw = image[:, :, 3] > threshold
    if not raw.any():
        return raw
    return ndimage.binary_erosion(raw, iterations=iterations)


def _oriented_face_normals(scene: trimesh.Trimesh) -> np.ndarray:
    normals = np.asarray(scene.face_normals, dtype=np.float64)
    if normals.size == 0:
        scene.rezero()
        normals = np.asarray(scene.face_normals, dtype=np.float64)
    if float(normals[:, 2].mean()) < 0:
        normals = -normals
    return normals


def _photo_eligible_faces(
    verts: np.ndarray,
    faces: np.ndarray,
    face_normals: np.ndarray,
    alpha: np.ndarray,
    content: tuple[int, int, int, int],
) -> np.ndarray:
    xmin, ymin = verts[:, 0].min(), verts[:, 1].min()
    xmax, ymax = verts[:, 0].max(), verts[:, 1].max()
    zmin, zmax = verts[:, 2].min(), verts[:, 2].max()
    z_eps = max(0.018, 0.03 * float(zmax - zmin))

    res = 768
    u = (verts[:, 0] - xmin) / (xmax - xmin + 1e-8)
    v = (verts[:, 1] - ymin) / (ymax - ymin + 1e-8)
    px = np.clip((u * (res - 1)).astype(np.int32), 0, res - 1)
    py = np.clip(((1.0 - v) * (res - 1)).astype(np.int32), 0, res - 1)

    depth = np.full((res, res), -np.inf, dtype=np.float32)
    order = np.argsort(verts[:, 2])
    depth[py[order], px[order]] = verts[order, 2].astype(np.float32)
    depth = ndimage.maximum_filter(depth, size=5)

    centroids = verts[faces].mean(axis=1)
    cu = (centroids[:, 0] - xmin) / (xmax - xmin + 1e-8)
    cv = (centroids[:, 1] - ymin) / (ymax - ymin + 1e-8)
    cpx = np.clip((cu * (res - 1)).astype(np.int32), 0, res - 1)
    cpy = np.clip(((1.0 - cv) * (res - 1)).astype(np.int32), 0, res - 1)
    visible = centroids[:, 2] >= (depth[cpy, cpx] - z_eps)
    front = face_normals[:, 2] >= FRONT_NORMAL_MIN

    left, top, right, bottom = content
    ipx = np.clip((left + cu * (right - left - 1)).astype(np.int32), 0, alpha.shape[1] - 1)
    ipy = np.clip((top + (1.0 - cv) * (bottom - top - 1)).astype(np.int32), 0, alpha.shape[0] - 1)
    in_mask = alpha[ipy, ipx]
    return front & visible & in_mask


def _build_atlas(
    image: np.ndarray,
    alpha: np.ndarray,
    palette: RegionPalette,
    content: tuple[int, int, int, int],
) -> Image.Image:
    front = _front_chart(image, alpha, palette, content)
    back = _back_chart(palette.darkened(0.84))
    atlas = np.zeros((CHART, CHART * 2, 3), dtype=np.uint8)
    atlas[:, :CHART] = front
    atlas[:, CHART:] = back
    atlas[:, CHART - GUTTER : CHART + GUTTER] = palette.jacket
    return Image.fromarray(atlas, "RGB")


def _front_chart(
    image: np.ndarray,
    alpha: np.ndarray,
    palette: RegionPalette,
    content: tuple[int, int, int, int],
) -> np.ndarray:
    left, top, right, bottom = content
    cropped_rgb = image[top:bottom, left:right, :3]
    cropped_alpha = alpha[top:bottom, left:right]
    bg = _back_chart(palette)
    rgb = np.array(Image.fromarray(cropped_rgb, "RGB").resize((CHART, CHART), Image.Resampling.BILINEAR))
    mask = np.array(
        Image.fromarray((cropped_alpha.astype(np.uint8) * 255), "L").resize((CHART, CHART), Image.Resampling.NEAREST)
    )
    mask = mask > 127
    # Extra edge trim after resize so transparent fringes never enter the texture.
    mask = ndimage.binary_erosion(mask, iterations=2)
    out = bg.copy()
    out[mask] = rgb[mask]
    return out


def _back_chart(palette: RegionPalette) -> np.ndarray:
    """Vertical clothing/body bands. v=0 feet, v=1 head, matching planar Y UVs."""
    rows = np.linspace(0.0, 1.0, CHART)
    # Image row 0 is top (head), so invert for writing pixels.
    chart = np.zeros((CHART, CHART, 3), dtype=np.uint8)
    colors = np.zeros((CHART, 3), dtype=np.uint8)
    for i, t in enumerate(rows):
        colors[CHART - 1 - i] = _color_for_height(t, palette)
    chart[:] = colors[:, None, :]
    return chart


def _color_for_height(t: float, palette: RegionPalette) -> np.ndarray:
    stops = (
        (0.00, palette.shoes),
        (0.08, palette.shoes),
        (0.12, palette.pants),
        (0.46, palette.pants),
        (0.52, palette.jacket),
        (0.80, palette.jacket),
        (0.84, palette.skin),
        (0.90, palette.skin),
        (0.93, palette.hair),
        (1.00, palette.hair),
    )
    for (t0, c0), (t1, c1) in zip(stops, stops[1:]):
        if t <= t1:
            span = max(t1 - t0, 1e-6)
            w = (t - t0) / span
            return (c0.astype(np.float32) * (1 - w) + c1.astype(np.float32) * w).astype(np.uint8)
    return palette.hair


def _mesh_with_two_chart_uvs(
    verts: np.ndarray,
    faces: np.ndarray,
    photo_faces: np.ndarray,
    atlas: Image.Image,
) -> trimesh.Trimesh:
    new_verts = verts[faces.reshape(-1)]
    new_faces = np.arange(len(new_verts), dtype=np.int64).reshape((-1, 3))

    xmin, ymin = verts[:, 0].min(), verts[:, 1].min()
    xmax, ymax = verts[:, 0].max(), verts[:, 1].max()
    x_n = (new_verts[:, 0] - xmin) / (xmax - xmin + 1e-8)
    y_n = (new_verts[:, 1] - ymin) / (ymax - ymin + 1e-8)
    is_photo = np.repeat(photo_faces, 3)

    uv = np.zeros((len(new_verts), 2), dtype=np.float64)
    span = 0.5 - 2.0 * UV_PAD
    uv[is_photo, 0] = UV_PAD + x_n[is_photo] * span
    uv[is_photo, 1] = UV_PAD + y_n[is_photo] * (1.0 - 2.0 * UV_PAD)
    uv[~is_photo, 0] = 0.5 + UV_PAD + x_n[~is_photo] * span
    uv[~is_photo, 1] = UV_PAD + y_n[~is_photo] * (1.0 - 2.0 * UV_PAD)

    material = PBRMaterial(
        name="avatar_visible_front",
        baseColorTexture=atlas,
        metallicFactor=0.0,
        roughnessFactor=0.74,
        doubleSided=False,
    )
    visual = TextureVisuals(uv=uv, material=material)
    return trimesh.Trimesh(vertices=new_verts, faces=new_faces, process=False, visual=visual)


def _as_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    scene = mesh
    if isinstance(mesh, trimesh.Scene):
        dumped = mesh.dump(concatenate=True)
        scene = dumped if dumped is not None else mesh
    if not isinstance(scene, trimesh.Trimesh):
        try:
            scene = trimesh.util.concatenate(tuple(scene.geometry.values()))
        except Exception:
            return mesh
    return scene
