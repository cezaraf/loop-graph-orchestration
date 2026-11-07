from __future__ import annotations
import os
from pathlib import Path
from .util import atomic_json, file_hash, safe_path, PolicyError


class MergeCoordinator:
    """CAS patch integration into run workspace, with replayable filesystem journal.

    Never merges into the user's checkout. Integration and publication are separate.
    """

    def __init__(self, workspace, journal):
        self.workspace = Path(workspace)
        self.journal = Path(journal)

    def integrate(self, unit, patch, base):
        target = {
            p: (digest_text(v) if v is not None else None) for p, v in patch.items()
        }
        for p in patch:
            current = file_hash(safe_path(self.workspace, p))
            if current not in (base.get(p), target[p]):
                raise PolicyError(f"Integration conflict: {p}")
        originals = {
            p: safe_path(self.workspace, p).read_text()
            if safe_path(self.workspace, p).is_file()
            else None
            for p in patch
        }
        record = {
            "unit": unit,
            "originals": originals,
            "patch": patch,
            "base": {p: base.get(p) for p in patch},
            "target": target,
            "status": "PREPARED",
        }
        atomic_json(self.journal, record)
        return self.recover()

    def recover(self):
        import json

        record = json.loads(self.journal.read_text())
        # Preflight all files before first mutation, including replay after partial write.
        for p, target in record["target"].items():
            if file_hash(safe_path(self.workspace, p)) not in (
                record["base"].get(p),
                target,
            ):
                raise PolicyError(f"Merge journal conflict: {p}")
        for p, content in record["patch"].items():
            path = safe_path(self.workspace, p)
            if file_hash(path) == record["target"][p]:
                continue
            if content is None:
                path.unlink(missing_ok=True)
            else:
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_name(path.name + ".lgo-tmp")
                with tmp.open("w") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
                os.replace(tmp, path)
        record["status"] = "COMMITTED"
        atomic_json(self.journal, record)
        return {
            "schema_version": "1.0",
            "unit": record["unit"],
            "passed": True,
            "status": "COMMITTED",
            "files": list(record["patch"]),
            "hashes": record["target"],
            "originals": record.get("originals", {}),
        }


def digest_text(text):
    import hashlib

    return hashlib.sha256(text.encode()).hexdigest()
