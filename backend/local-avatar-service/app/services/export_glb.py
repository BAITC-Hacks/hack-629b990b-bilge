from pathlib import Path

import numpy as np
import trimesh
from PIL import Image


def keep_main_body(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    scene = _as_trimesh(mesh)
    parts = scene.split(only_watertight=False)
    if not parts:
        return scene
    scored: list[tuple[float, trimesh.Trimesh]] = []
    for part in parts:
        if part.faces is None or len(part.faces) < 80:
            continue
        extents = np.asarray(part.extents, dtype=float)
        height = float(extents[1]) if extents.size >= 2 else 0.0
        span = float(extents.max()) if extents.size else 0.0
        score = height * float(part.area)
        if span > 0 and height < 0.28 * span:
            score *= 0.04
        scored.append((score, part))
    if not scored:
        return max(parts, key=lambda part: 0 if part.faces is None else len(part.faces))
    return max(scored, key=lambda item: item[0])[1]


def project_front_colors(mesh: trimesh.Trimesh, person_image: Image.Image) -> trimesh.Trimesh:
    """Visibility-aware front bake. Back/unseen faces never receive the front photo."""
    from app.services.texture_bake import bake_visible_front_texture

    return bake_visible_front_texture(mesh, person_image)


def _as_trimesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
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


def normalize_mesh(mesh: trimesh.Trimesh) -> trimesh.Trimesh:
    scene = _as_trimesh(mesh).copy()
    if scene.vertices is None or len(scene.vertices) == 0:
        raise ValueError("Generated mesh is empty")

    scene.remove_unreferenced_vertices()
    bounds = scene.bounds
    center = (bounds[0] + bounds[1]) / 2.0
    scene.apply_translation(-center)
    extent = float((scene.extents.max() if scene.extents is not None else 1.0) or 1.0)
    target = 1.7
    scene.apply_scale(target / extent)
    scene.apply_translation([0.0, -float(scene.bounds[0][1]), 0.0])

    if scene.visual is None or getattr(scene.visual, "kind", None) in {None, "empty"}:
        scene.visual = trimesh.visual.ColorVisuals(mesh=scene, face_colors=[198, 210, 196, 255])
    return scene


def export_trimesh_glb(mesh: trimesh.Trimesh, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    exported = mesh.export(file_obj=str(output_path), file_type="glb")
    if exported is not None and not output_path.exists():
        output_path.write_bytes(exported if isinstance(exported, bytes) else bytes(exported))
    if not output_path.exists() or output_path.stat().st_size < 64:
        raise ValueError("GLB export produced an empty file")
    return output_path
