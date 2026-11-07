import json
from pathlib import Path
import os
import shutil
import pytest
from lgo.cli import main
from lgo.engine import Engine
from lgo.openspec import OpenSpecAdapter


def test_bootstrap_dryrun_preserves_existing_config(tmp_path, capsys):
    assert main(["--root", str(tmp_path), "--dry-run", "init"]) == 0
    assert not (tmp_path / ".lgo").exists()
    assert main(["--root", str(tmp_path), "init"]) == 0
    path = tmp_path / ".lgo/config.yaml"
    original = path.read_bytes()
    assert main(["--root", str(tmp_path), "init"]) == 0
    assert path.read_bytes() == original
    assert not (tmp_path / "openspec").exists()
    assert main(["--root", str(tmp_path), "update"]) == 0
    assert main(["--root", str(tmp_path), "uninstall"]) == 0
    assert path.read_bytes() == original


def test_cli_exit_codes_and_json(tmp_path, capsys):
    assert main(["--root", str(tmp_path), "--json", "validate-plan", "missing"]) == 2
    result = json.loads(capsys.readouterr().out)
    assert result["error"] and result["reason"]


def test_cli_real_openspec_plan_dryrun_and_archive_block(tmp_path, capsys, monkeypatch):
    executable = os.environ.get("LGO_OPENSPEC") or shutil.which("openspec")
    if not executable:
        pytest.skip("Official OpenSpec1.16.1 required")
    monkeypatch.setenv("LGO_OPENSPEC", executable)
    source = Path(__file__).resolve().parents[1] / "examples/tipo-exame"
    shutil.copytree(source / "openspec", tmp_path / "openspec")
    (tmp_path / ".lgo/bindings").mkdir(parents=True)
    shutil.copy2(
        source / ".lgo/bindings/add-tipo-exame.json",
        tmp_path / ".lgo/bindings/add-tipo-exame.json",
    )
    prefix = ["--root", str(tmp_path), "--json"]
    assert main(prefix + ["--dry-run", "plan", "add-tipo-exame"]) == 0
    assert not (tmp_path / ".lgo/plans/add-tipo-exame.json").exists()
    assert main(prefix + ["plan", "add-tipo-exame"]) == 0
    assert main(prefix + ["validate-plan", "add-tipo-exame"]) == 0
    assert main(prefix + ["--dry-run", "run", "add-tipo-exame"]) == 0
    assert not (tmp_path / ".lgo/state.sqlite").exists()
    g = json.loads((tmp_path / ".lgo/plans/add-tipo-exame.json").read_text())
    e = Engine(tmp_path)
    e.start(g)
    e.close()
    assert main(prefix + ["prepare-archive", "add-tipo-exame"]) == 3
    out = capsys.readouterr().out
    assert "UNACCEPTED_UNITS" in out and "AUTHORITY_GATE_NOT_PASSED" in out
    assert (tmp_path / "openspec/changes/add-tipo-exame").is_dir()
    assert main(prefix + ["sync-progress", "add-tipo-exame"]) == 0
    assert not any(
        t["checked"] for t in OpenSpecAdapter(tmp_path).load("add-tipo-exame")["tasks"]
    )


def test_core_has_no_proprietary_dependencies():
    import tomllib

    cfg = tomllib.loads(
        (Path(__file__).resolve().parents[1] / "pyproject.toml").read_text()
    )
    deps = cfg["project"]["dependencies"]
    assert {x.split(">")[0] for x in deps} == {"jsonschema", "PyYAML"}
