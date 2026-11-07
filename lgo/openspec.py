"""OpenSpec 1.16.1 public CLI composition. No alternative spec parser."""

from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

SUPPORTED_VERSION = "1.16.1"


class OpenSpecAdapter:
    def __init__(self, root, executable=None):
        self.root = Path(root).resolve()
        executable = (
            executable or os.environ.get("LGO_OPENSPEC") or shutil.which("openspec")
        )
        if not executable:
            local = self.root / "node_modules/.bin/openspec"
            executable = str(local) if local.exists() else None
        self.executable = str(executable) if executable else None
        self._version = None

    def _call(self, *args, require_success=True):
        if not self.executable:
            raise RuntimeError(
                "OpenSpec CLI ausente. Instale @fission-ai/openspec@1.16.1; use LGO_OPENSPEC."
            )
        env = {
            **os.environ,
            "OPENSPEC_TELEMETRY": "0",
            "DO_NOT_TRACK": "1",
            "NO_COLOR": "1",
        }
        result = subprocess.run(
            [self.executable, *args],
            cwd=self.root,
            env=env,
            capture_output=True,
            text=True,
            timeout=45,
            check=False,
        )
        if require_success and result.returncode:
            raise ValueError(
                f"OpenSpec {args[0]} falhou ({result.returncode}): {result.stderr.strip()} {result.stdout.strip()}"
            )
        return result

    @property
    def version(self):
        if self._version is None:
            detected = self._call("--version").stdout.strip()
            if detected != SUPPORTED_VERSION:
                raise ValueError(
                    f"OpenSpec incompatível: {detected}; versão suportada: {SUPPORTED_VERSION}"
                )
            self._version = detected
        return self._version

    def _json(self, *args):
        self.version
        result = self._call(*args)
        try:
            return json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            raise ValueError("OpenSpec não retornou JSON válido") from exc

    def _change_path(self, change):
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", change) or change == "archive":
            raise ValueError("ID de mudança inválido")
        changes = self.root / "openspec/changes"
        base = changes / change
        if (self.root / "openspec").is_symlink() or changes.is_symlink():
            raise ValueError("Raiz OpenSpec symlink rejeitada")
        if (
            not base.is_dir()
            or base.is_symlink()
            or not base.resolve().is_relative_to(changes.resolve())
        ):
            raise ValueError(f"Mudança inexistente ou insegura: {change}")
        for path in base.rglob("*"):
            if path.is_symlink():
                raise ValueError(f"Artefato symlink rejeitado: {path}")
        return base

    def discover(self):
        """Return native OpenSpec discovery data (including official task counts)."""
        return self._json("list", "--json")

    def validate(self, change):
        self._change_path(change)
        self.version
        result = self._call(
            "validate",
            change,
            "--type",
            "change",
            "--strict",
            "--json",
            "--no-interactive",
            require_success=False,
        )
        try:
            details = json.loads(result.stdout)
        except json.JSONDecodeError:
            details = {"error": result.stderr.strip() or result.stdout.strip()}
        return {
            "valid": result.returncode == 0,
            "details": details,
            "openspec_version": self.version,
        }

    @staticmethod
    def _task_id(task):
        match = re.match(r"^(\d+(?:\.\d+)+)\s+", task["description"])
        return match.group(1) if match else task["id"]

    def load(self, change):
        base = self._change_path(change)
        validation = self.validate(change)
        if not validation["valid"]:
            raise ValueError(
                f"Mudança OpenSpec inválida: {json.dumps(validation['details'], ensure_ascii=False)}"
            )
        native = self._json(
            "show", change, "--type", "change", "--json", "--no-interactive"
        )
        status = self._json("status", "--change", change, "--json")
        schema = status.get("schemaName", status.get("schema", "spec-driven"))
        if schema != "spec-driven":
            raise ValueError(f"Schema OpenSpec não suportado: {schema}")
        apply = self._json("instructions", "apply", "--change", change, "--json")
        tasks = [
            {
                "id": self._task_id(t),
                "official_id": t["id"],
                "text": t["description"],
                "checked": t["done"],
                "sourcePath": t["sourcePath"],
                "line": t["line"],
            }
            for t in apply.get("tasks", [])
        ]
        if len({t["id"] for t in tasks}) != len(tasks):
            raise ValueError("IDs de tasks duplicados; explicite numeração única")
        requirements = []
        for delta in native.get("deltas", []):
            reqs = delta.get("requirements") or (
                [delta["requirement"]] if delta.get("requirement") else []
            )
            if delta["operation"] == "RENAMED":
                rename = delta["rename"]
                reqs = [
                    {
                        "name": rename["to"],
                        "text": delta["description"],
                        "scenarios": [],
                    }
                ]
            for req in reqs:
                name = req.get("name") or req["text"].splitlines()[0]
                requirements.append(
                    {
                        "id": f"{delta['spec']}::{name}",
                        "name": name,
                        "text": req["text"],
                        "scenarios": req.get("scenarios", []),
                        "capability": delta["spec"],
                        "operation": delta["operation"],
                        **({"rename": delta["rename"]} if delta.get("rename") else {}),
                    }
                )
        if len({r["id"] for r in requirements}) != len(requirements):
            raise ValueError("Requisitos duplicados na mesma capability")
        artifacts = {}
        for path in sorted(base.rglob("*")):
            if path.is_file():
                content = path.read_bytes()
                # Task checkboxes are progress; do not invalidate a plan after synchronizing progress.
                if path.suffix == ".md":
                    text = content.decode("utf-8")
                    content = re.sub(
                        r"(?m)^(\s*[-*+] )\[[xX ]\]", r"\1[ ]", text
                    ).encode()
                artifacts[path.relative_to(self.root).as_posix()] = hashlib.sha256(
                    content
                ).hexdigest()
        spec_hash = hashlib.sha256(
            json.dumps(artifacts, sort_keys=True).encode()
        ).hexdigest()
        metadata_file = base / ".openspec.yaml"
        import yaml

        metadata = (
            yaml.safe_load(metadata_file.read_text()) if metadata_file.exists() else {}
        )
        return {
            "schema_version": "1.0",
            "id": change,
            "schema": schema,
            "openspec_version": self.version,
            "metadata": metadata or {},
            "tasks": tasks,
            "requirements": requirements,
            "capabilities": sorted({r["capability"] for r in requirements}),
            "artifacts": artifacts,
            "spec_hash": spec_hash,
            "planning_status": status,
            "proposal": (base / "proposal.md").read_text(),
            "design": (base / "design.md").read_text()
            if (base / "design.md").exists()
            else None,
        }

    def sync_tasks(self, change, accepted_task_ids, *, expected_spec_hash=None):
        """Low-level operation: caller MUST obtain accepted IDs from a trusted run gate.

        This helper grants no authority. It only updates verified source locations.
        """
        model = self.load(change)
        if expected_spec_hash is not None and model["spec_hash"] != expected_spec_hash:
            raise ValueError("Especificação mudou desde a execução")
        accepted = set(accepted_task_ids)
        known = {t["id"] for t in model["tasks"]}
        if not accepted <= known:
            raise ValueError("Task desconhecida na sincronização")
        contents = {}
        for task in model["tasks"]:
            path = Path(task["sourcePath"])
            if not path.is_absolute():
                path = self.root / path
            if path.is_symlink() or not path.resolve().is_relative_to(
                self._change_path(change)
            ):
                raise ValueError("Task fora da mudança")
            lines = contents.setdefault(
                path, path.read_text().splitlines(keepends=True)
            )
            index = task["line"] - 1
            if index < 0 or index >= len(lines):
                raise ValueError("Localização de task obsoleta")
            line = lines[index]
            match = re.match(r"^(\s*[-*+] )\[([xX ])\](\s+)(.*?)(\r?\n)?$", line)
            if not match or match.group(4).strip() != task["text"].strip():
                raise ValueError("Task foi modificada; recarregue instruções oficiais")
            checked = "x" if task["id"] in accepted else " "
            lines[index] = (
                f"{match.group(1)}[{checked}]{match.group(3)}{match.group(4)}{match.group(5) or ''}"
            )
        for path, lines in contents.items():
            with tempfile.NamedTemporaryFile(
                "w", dir=path.parent, delete=False, encoding="utf-8"
            ) as tmp:
                tmp.write("".join(lines))
                temp = tmp.name
            os.replace(temp, path)
        return {
            "change": change,
            "accepted_task_ids": sorted(accepted),
            "updated": [str(p.relative_to(self.root)) for p in contents],
        }

    def prepare_archive(
        self, change, *, all_accepted=False, integration_passed=False, gate_passed=False
    ):
        """Prepare only. Never sync specs/archive automatically or treat checkboxes as evidence."""
        validation = self.validate(change)
        blockers = []
        if not validation["valid"]:
            blockers.append("OPENSPEC_INVALID")
        if not all_accepted:
            blockers.append("UNACCEPTED_UNITS")
        if not integration_passed:
            blockers.append("INTEGRATION_NOT_PASSED")
        if not gate_passed:
            blockers.append("AUTHORITY_GATE_NOT_PASSED")
        return {
            "change": change,
            "ready": not blockers,
            "blockers": blockers,
            "operations": [
                "Use official openspec-sync-specs skill to synchronize only, or archive command to synchronize and archive"
            ],
            "archive_argv": ["openspec", "archive", change],
            "executed": False,
        }
