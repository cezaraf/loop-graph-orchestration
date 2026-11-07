from __future__ import annotations
import hashlib
import json
import os
import tempfile
from pathlib import Path, PurePosixPath


class PolicyError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def file_hash(path):
    return (
        hashlib.sha256(Path(path).read_bytes()).hexdigest()
        if Path(path).is_file()
        else None
    )


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def safe_path(root, relative):
    p = PurePosixPath(relative)
    if not relative or p.is_absolute() or ".." in p.parts or "\\" in relative:
        raise PolicyError(f"Unsafe path: {relative}")
    root = Path(root).resolve()
    target = root / relative
    current = root
    for part in p.parts:
        current = current / part
        if current.is_symlink():
            raise PolicyError(f"Symlink rejected: {relative}")
    if not target.resolve().is_relative_to(root):
        raise PolicyError("Path escapes workspace")
    return target


def matches(path, patterns):
    from fnmatch import fnmatchcase

    return any(
        fnmatchcase(path, p) or (p.endswith("/**") and path.startswith(p[:-3] + "/"))
        for p in patterns
    )


PROTECTED = (
    ".lgo",
    "openspec",
    ".git",
    "verification",
    ".env",
    "secrets",
    "node_modules",
    ".venv",
)


def permitted(path, scope):
    p = PurePosixPath(path)
    if any(x in PROTECTED or x.startswith(".env") for x in p.parts):
        return False
    return matches(path, scope)


def snapshot(root):
    root = Path(root)
    return {
        p.relative_to(root).as_posix(): file_hash(p)
        for p in sorted(root.rglob("*"))
        if p.is_file() and not p.is_symlink()
    }
