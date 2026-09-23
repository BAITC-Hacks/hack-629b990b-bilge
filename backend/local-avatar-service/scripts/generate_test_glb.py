#!/usr/bin/env python3
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models.hunyuan import HunyuanAvatarBackend  # noqa: E402
from app.storage.paths import GENERATED_DIR, ensure_dirs  # noqa: E402

PRIMARY = Path("/home/mmr/Pictures/beebo.jpeg")
FALLBACKS = (
    Path("/home/mmr/Pictures/handsome guy.png"),
    Path("/home/mmr/Pictures/mamyr_altaibek.jpg"),
)


def validate_glb(path: Path) -> str:
    import trimesh

    loaded = trimesh.load(str(path), force="mesh")
    verts_arr = getattr(loaded, "vertices", None)
    faces_arr = getattr(loaded, "faces", None)
    verts = 0 if verts_arr is None else len(verts_arr)
    faces = 0 if faces_arr is None else len(faces_arr)
    if verts < 8 or path.stat().st_size < 64:
        raise RuntimeError(f"GLB too small or empty: size={path.stat().st_size} verts={verts}")
    return f"TRIMESH_OK vertices={verts} faces={faces}"


def main() -> int:
    ensure_dirs()
    candidates = [PRIMARY, *FALLBACKS]
    out = GENERATED_DIR / "beebo.glb"
    backend = HunyuanAvatarBackend()
    print(f"BACKEND_INIT {backend.health()}")
    last_error = None
    for src in candidates:
        if not src.exists():
            print(f"MISSING {src}")
            continue
        print(f"INPUT {src}")
        print(f"OUTPUT {out}")
        start = time.time()
        try:
            result = backend.generate(src, out)
            duration = time.time() - start
            size = out.stat().st_size
            print(f"DURATION_SEC {duration:.1f}")
            print(f"GLB_PATH {out}")
            print(f"GLB_SIZE {size}")
            print(f"RESULT {result}")
            print(validate_glb(out))
            print(f"USED {src}")
            return 0
        except Exception as exc:
            last_error = exc
            print(f"FAILED {src}: {exc}")
    raise SystemExit(f"ALL_INPUTS_FAILED {last_error}")


if __name__ == "__main__":
    raise SystemExit(main())
