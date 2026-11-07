"""Package the complete reference source without caches, secrets or dependencies."""

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
EXCLUDE = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    ".ruff_cache",
    "node_modules",
    ".angular",
    "target",
    "dist",
    "build",
    "secrets",
}


def include(path):
    parts = path.relative_to(ROOT).parts
    if path.is_symlink() or any(
        p in EXCLUDE or p.endswith(".egg-info") or p.startswith(".env") for p in parts
    ):
        return False
    if ".lgo" in parts and any(
        p
        in {
            "runs",
            "state.sqlite",
            "state.sqlite-wal",
            "state.sqlite-shm",
            "scheduler.lock",
        }
        for p in parts
    ):
        return False
    return path.is_file() and path.suffix not in {".pyc", ".zip"}


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    target = a.output.resolve()
    if target.exists():
        raise SystemExit("Use um destino novo para preservar pacotes existentes.")
    target.parent.mkdir(parents=True, exist_ok=True)
    files = [f for f in sorted(ROOT.rglob("*")) if include(f)]
    manifest = {
        f.relative_to(ROOT).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest()
        for f in files
    }
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            z.write(f, "lgo/" + f.relative_to(ROOT).as_posix())
        z.writestr(
            "lgo/DELIVERY-MANIFEST.json",
            json.dumps({"schema_version": "1.0", "sha256": manifest}, indent=2) + "\n",
        )
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        assert all(
            hashlib.sha256(z.read("lgo/" + name)).hexdigest() == expected
            for name, expected in manifest.items()
        )
    print(
        json.dumps(
            {
                "file": str(target),
                "files": len(files) + 1,
                "bytes": target.stat().st_size,
                "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
            },
            indent=2,
        )
    )
