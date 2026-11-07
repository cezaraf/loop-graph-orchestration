"""Official CLI integration tests. Install package.json dev dependencies before running."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import pytest
from lgo.openspec import OpenSpecAdapter


@pytest.fixture
def executable():
    binary = os.environ.get("LGO_OPENSPEC") or shutil.which("openspec")
    local = Path(__file__).resolve().parents[1] / "node_modules/.bin/openspec"
    if not binary and local.exists():
        binary = str(local)
    if not binary:
        pytest.skip("OpenSpec CLI missing: npm ci or set LGO_OPENSPEC")
    return binary


@pytest.fixture
def project(tmp_path, executable):
    (tmp_path / "openspec").mkdir()
    (tmp_path / "openspec/config.yaml").write_text("schema: spec-driven\n")
    p = tmp_path / "openspec/changes/add-demo"
    (p / "specs/demo").mkdir(parents=True)
    (p / ".openspec.yaml").write_text("schema: spec-driven\ncreated: 2026-11-06\n")
    (p / "proposal.md").write_text("""## Why

Agent orchestration needs deterministic and independently verifiable execution with persistent evidence.

## What Changes

- Add a deterministic demonstration capability and native test coverage.

## Capabilities

### New Capabilities

- `demo`: Demonstration behavior.

### Modified Capabilities

None.

## Impact

Tests and demonstration source files.
""")
    (p / "specs/demo/spec.md").write_text("""## ADDED Requirements

### Requirement: Deterministic response
The system SHALL return the expected response.

#### Scenario: Request succeeds
- **WHEN** the request is valid
- **THEN** return a valid response
""")
    (p / "design.md").write_text(
        "## Context\n\nNative demo adapter.\n\n## Decisions\n\nDeterministic output.\n"
    )
    (p / "tasks.md").write_text(
        "## 1. Implement\n\n- [ ] 1.1 Implement response and verify unit test\n- [ ] 1.2 Document response and verify documentation\n"
    )
    return tmp_path, OpenSpecAdapter(tmp_path, executable)


def test_native_read_validation_trace_and_status(project):
    root, a = project
    assert a.validate("add-demo")["valid"]
    model = a.load("add-demo")
    assert model["openspec_version"] == "1.16.1"
    assert [t["id"] for t in model["tasks"]] == ["1.1", "1.2"]
    assert all(t["sourcePath"] and t["line"] > 0 for t in model["tasks"])
    assert model["requirements"][0]["id"] == "demo::Deterministic response"
    assert model["requirements"][0]["scenarios"][0]["name"] == "Request succeeds"
    assert model["capabilities"] == ["demo"]
    assert "add-demo" in json.dumps(a.discover())


def test_native_reject_invalid_change(project):
    root, a = project
    p = root / "openspec/changes/add-demo/specs/demo/spec.md"
    p.write_text(
        "## ADDED Requirements\n\n### Requirement: Invalid\nNo normative statement.\n"
    )
    assert not a.validate("add-demo")["valid"]
    with pytest.raises(ValueError, match="inválida"):
        a.load("add-demo")


def test_sync_preserves_artifacts_and_hash_and_only_verified_tasks(project):
    root, a = project
    before = a.load("add-demo")
    proposal = (root / "openspec/changes/add-demo/proposal.md").read_bytes()
    spec = (root / "openspec/changes/add-demo/specs/demo/spec.md").read_bytes()
    a.sync_tasks("add-demo", ["1.1"], expected_spec_hash=before["spec_hash"])
    after = a.load("add-demo")
    assert after["tasks"][0]["checked"] and not after["tasks"][1]["checked"]
    assert before["artifacts"] == after["artifacts"]
    assert before["spec_hash"] == after["spec_hash"]
    assert proposal == (root / "openspec/changes/add-demo/proposal.md").read_bytes()
    assert spec == (root / "openspec/changes/add-demo/specs/demo/spec.md").read_bytes()
    with pytest.raises(ValueError, match="desconhecida"):
        a.sync_tasks("add-demo", ["3.4"])
    with pytest.raises(ValueError, match="mudou"):
        a.sync_tasks("add-demo", ["1.1"], expected_spec_hash="f" * 64)


def test_archive_preparation_fails_closed_even_with_native_checked_tasks(project):
    root, a = project
    a.sync_tasks("add-demo", ["1.1", "1.2"])
    blocked = a.prepare_archive("add-demo")
    assert not blocked["ready"]
    assert "UNACCEPTED_UNITS" in blocked["blockers"]
    ready = a.prepare_archive(
        "add-demo", all_accepted=True, integration_passed=True, gate_passed=True
    )
    assert ready["ready"] and ready["executed"] is False
    assert (root / "openspec/changes/add-demo").exists()


def test_symlink_and_path_traversal_rejected(project):
    root, a = project
    with pytest.raises(ValueError):
        a.load("../outside")
    (root / "openspec/changes/add-demo/leak.md").symlink_to("/etc/passwd")
    with pytest.raises(ValueError, match="symlink"):
        a.load("add-demo")


def test_incompatible_version_is_fail_closed(tmp_path):
    class Fake(OpenSpecAdapter):
        def _call(self, *args, **kwargs):
            return subprocess.CompletedProcess(args, 0, stdout="9.0.0\n", stderr="")

    adapter = Fake(tmp_path, "fake")
    for _ in range(2):
        with pytest.raises(ValueError, match="incompatível"):
            adapter.version


def test_native_modified_removed_renamed_delta_operations(project):
    root, a = project
    spec = root / "openspec/changes/add-demo/specs/demo/spec.md"
    spec.write_text("""## MODIFIED Requirements

### Requirement: Updated behavior
The system SHALL use the updated deterministic behavior.

#### Scenario: Updated request
- **WHEN** a request arrives
- **THEN** return the updated value

## REMOVED Requirements

### Requirement: Old behavior
**Reason**: Replaced by updated behavior.
**Migration**: Use the new behavior.

## RENAMED Requirements

- FROM: `### Requirement: Original name`
- TO: `### Requirement: Current name`
""")
    model = a.load("add-demo")
    assert {r["operation"] for r in model["requirements"]} == {
        "MODIFIED",
        "REMOVED",
        "RENAMED",
    }
    renamed = next(r for r in model["requirements"] if r["operation"] == "RENAMED")
    assert renamed["id"] == "demo::Current name"
    assert renamed["rename"] == {"from": "Original name", "to": "Current name"}
