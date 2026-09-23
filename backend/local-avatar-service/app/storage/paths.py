from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
TMP_DIR = SERVICE_ROOT / "tmp"
GENERATED_DIR = SERVICE_ROOT / "generated"
VENDOR_DIR = SERVICE_ROOT / "vendor"


def ensure_dirs() -> None:
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
