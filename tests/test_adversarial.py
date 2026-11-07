"""Adversarial runtime checks: authority, interrupted effects and trusted context.

These tests verify the actual controller boundary. They do not claim that an
in-process Python adapter is an OS sandbox or that HMAC proves human presence.
"""

from __future__ import annotations

import copy
import os
from pathlib import Path
import sys
import time

import pytest

import lgo.engine as engine_module
from lgo.engine import Engine, load_config
from lgo.gates import ApprovalAuthority
from lgo.util import PolicyError, digest
from lgo.verification import VerificationEngine


def adversarial_graph(*, files=None, risk="LOW", max_attempts=3):
    files = {"src/result.txt": "verified"} if files is None else files
    verifier = {
        "kind": "file_contains",
        "path": "src/result.txt",
        "contains": "verified",
    }
    return {
        "schema_version": "1.0",
        "change_id": "adversarial",
        "spec_hash": digest("first-spec"),
        "external_inputs": [],
        "units": [
            {
                "id": "writer",
                "objective": "Create the verified output",
                "task_id": "1.1",
                "requirement_ids": ["capability::Verified output"],
                "inputs": [],
                "outputs": ["src/result.txt"],
                "dependencies": [],
                "resources": [],
                "file_scope": ["src/**"],
                "acceptance": ["Output contains verified"],
                "verifiers": [verifier],
                "agent": {"adapter": "mock", "attempts": [{"files": files}]},
                "risk": risk,
                "timeout_seconds": 1,
                "budget": {"max_cost": 1, "max_tokens": 100},
                "max_attempts": max_attempts,
            }
        ],
        "integration_verifiers": [verifier],
    }


def adversarial_config(**extra):
    return {"schema_version": "1.0", "concurrency": 3, "commands": {}, **extra}


def external_authority(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    key = tmp_path / "operator.key"
    key.write_bytes(os.urandom(32))
    key.chmod(0o600)
    return project, ApprovalAuthority(key, project)


@pytest.mark.asyncio
async def test_high_risk_fake_approval_never_dispatches_worker(tmp_path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = engine.start(adversarial_graph(risk="HIGH"))
        result = await engine.execute(
            run["id"], approval={"approved": True, "actor": "human"}
        )
        assert result["state"] == "WAITING_APPROVAL"
        assert result["nodes"]["writer"]["attempts"] == 0
        assert not (Path(result["workspace"]) / "src/result.txt").exists()
        assert result["gates"][-1]["verdict"] == "HUMAN_APPROVAL_REQUIRED"
    finally:
        engine.close()


def test_hmac_rejects_wrong_binding_action_expiry_and_actor(tmp_path):
    project, authority = external_authority(tmp_path)
    payload = {
        "binding": "reviewed-content",
        "action": "execute",
        "expires_at": time.time() + 60,
        "actor": "operator-service",
    }
    token = authority.sign(payload)
    assert authority.verify(token, "reviewed-content", "execute")
    assert not authority.verify(token, "different-content", "execute")
    assert not authority.verify(token, "reviewed-content", "promote-learning")
    changed = copy.deepcopy(token)
    changed["payload"]["binding"] = "different-content"
    assert not authority.verify(changed, "different-content", "execute")
    expired = authority.sign({**payload, "expires_at": time.time() - 1})
    assert not authority.verify(expired, "reviewed-content", "execute")
    no_actor = authority.sign({**payload, "actor": ""})
    assert not authority.verify(no_actor, "reviewed-content", "execute")


def test_authority_key_in_worker_project_or_publicly_readable_is_rejected(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    internal = project / "operator.key"
    internal.write_bytes(os.urandom(32))
    internal.chmod(0o600)
    with pytest.raises(PolicyError, match="outside project"):
        ApprovalAuthority(internal, project)
    public = tmp_path / "public.key"
    public.write_bytes(os.urandom(32))
    public.chmod(0o644)
    with pytest.raises(PolicyError, match="0600"):
        ApprovalAuthority(public, project)


@pytest.mark.asyncio
async def test_interrupted_nonidempotent_adapter_is_not_called_again(tmp_path):
    marker = tmp_path / "external-effect-count.txt"
    cfg = adversarial_config(
        allow_process_agents=True,
        agent_commands={
            "effect": [
                sys.executable,
                "-c",
                f"from pathlib import Path; Path({str(marker)!r}).write_text('effect')",
            ]
        },
    )
    graph = adversarial_graph()
    graph["units"][0]["agent"] = {"adapter": "process", "profile": "effect"}
    engine = Engine(tmp_path, cfg)
    try:
        run = engine.start(graph)
        run["nodes"]["writer"].update(state="RUNNING", attempts=1)
        engine.store.save(run)
        result = await engine.execute(run["id"])
        assert result["nodes"]["writer"]["state"] == "BLOCKED"
        assert "Ambiguous external effect" in result["nodes"]["writer"]["reason"]
        assert result["nodes"]["writer"]["attempts"] == 1
        assert not marker.exists()
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_accepted_output_tamper_blocks_reverification(tmp_path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(adversarial_graph())["id"])
        assert run["state"] == "ACCEPTED"
        (Path(run["workspace"]) / "src/result.txt").write_text("tampered")
        with pytest.raises(PolicyError, match="tampered"):
            await engine.verify(run["id"])
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_history_tamper_blocks_resume(tmp_path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = engine.start(adversarial_graph())
        engine.store.db.execute(
            "UPDATE events SET data=? WHERE seq=(SELECT MIN(seq) FROM events)",
            ('{"forged":true}',),
        )
        with pytest.raises(PolicyError, match="history corrupted"):
            await engine.execute(run["id"])
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_trusted_verifier_change_blocks_resume(tmp_path):
    verification = tmp_path / "verification"
    verification.mkdir()
    oracle = verification / "oracle.py"
    oracle.write_text("print('original')\n")
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = engine.start(adversarial_graph())
        oracle.write_text("print('changed')\n")
        with pytest.raises(PolicyError, match="Policy/spec/verifier changed"):
            await engine.execute(run["id"])
    finally:
        engine.close()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "../escape.txt",
        "/tmp/escape.txt",
        ".lgo/config.yaml",
        "openspec/specs/cap/spec.md",
        "verification/oracle.py",
        "src/.env",
    ],
)
async def test_patch_cannot_change_host_control_files_or_escape(tmp_path, path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(
            engine.start(adversarial_graph(files={path: "forged"}))["id"]
        )
        assert run["nodes"]["writer"]["state"] == "BLOCKED"
        assert run["nodes"]["writer"]["attempts"] == 1
        assert (
            run["nodes"]["writer"]["correction"]["failure_class"] == "POLICY_VIOLATION"
        )
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_context_omits_secrets_and_includes_declared_readonly_input(
    tmp_path, monkeypatch
):
    (tmp_path / "src").mkdir()
    (tmp_path / "contracts").mkdir()
    (tmp_path / "secrets").mkdir()
    (tmp_path / "src/existing.txt").write_text("existing")
    (tmp_path / "contracts/api.json").write_text('{"response":404}')
    (tmp_path / "src/.env").write_text("SECRET=nested")
    (tmp_path / ".env").write_text("SECRET=root")
    (tmp_path / "secrets/password.txt").write_text("secret password")
    captured = []

    class RecordingAdapter:
        idempotent = True

        async def execute(self, request):
            captured.append(request)
            return {
                "schema_version": "1.0",
                "files": {"src/result.txt": "verified"},
                "usage": {"cost": 0, "tokens": 0},
                "summary": "scoped output",
                "idempotency_key": request["idempotency_key"],
            }

    monkeypatch.setattr(
        engine_module, "adapter_for", lambda unit, config: RecordingAdapter()
    )
    graph = adversarial_graph()
    graph["external_inputs"] = ["contracts/api.json"]
    graph["units"][0]["inputs"] = ["contracts/api.json"]
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(graph)["id"])
        assert run["state"] == "ACCEPTED"
        assert captured
        inputs = captured[0]["inputs"]
        assert inputs["contracts/api.json"] == '{"response":404}'
        assert not any(".env" in path or "secrets" in path for path in inputs)
        assert "SECRET=" not in str(captured)
        assert not (Path(run["workspace"]) / ".env").exists()
        assert not (Path(run["workspace"]) / "secrets").exists()
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_reported_budget_excess_is_terminal_policy_failure(tmp_path):
    graph = adversarial_graph()
    graph["units"][0]["agent"]["attempts"][0]["usage"] = {"cost": 2, "tokens": 101}
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(graph)["id"])
        node = run["nodes"]["writer"]
        assert node["state"] == "BLOCKED"
        assert node["attempts"] == 1
        assert "budget exceeded" in node["correction"]["reason"]
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_replan_invalidates_accepted_units_when_spec_hash_changes(tmp_path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        graph = adversarial_graph()
        run = await engine.execute(engine.start(graph)["id"])
        assert run["state"] == "ACCEPTED"
        graph["spec_hash"] = digest("changed-behavior-same-requirement-name")
        replanned = engine.replan(
            run["id"], graph, "Behavior changed under a stable requirement name"
        )
        assert replanned["nodes"]["writer"]["state"] != "PASSED"
        assert not replanned["integration"]["passed"]
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_replan_invalidates_accepted_units_when_policy_changes(tmp_path):
    engine = Engine(tmp_path, adversarial_config())
    try:
        graph = adversarial_graph()
        run = await engine.execute(engine.start(graph)["id"])
        engine.config["concurrency"] = 2
        replanned = engine.replan(run["id"], graph, "Reviewed host policy changed")
        assert replanned["nodes"]["writer"]["state"] != "PASSED"
    finally:
        engine.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("keyword", ["$ref", "$dynamicRef"])
async def test_schema_oracle_never_fetches_remote_references(
    tmp_path, monkeypatch, keyword
):
    """JSON Schema 2020-12 has two reference keywords, not only $ref."""
    import urllib.request

    calls = []

    def forbidden_network(*args, **kwargs):
        calls.append(args)
        raise RuntimeError("Network access was attempted by schema validator")

    monkeypatch.setattr(urllib.request, "urlopen", forbidden_network)
    (tmp_path / "payload.json").write_text("{}")
    result = await VerificationEngine(adversarial_config()).check(
        [
            {
                "kind": "json_schema",
                "path": "payload.json",
                "schema": {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    keyword: "https://untrusted.example/secret-exfiltration-schema",
                },
            }
        ],
        tmp_path,
    )
    assert not result["passed"]
    assert not calls, "Oracle performed remote retrieval before blocking"
    assert result["results"][0]["failure_class"] == "POLICY_VIOLATION"


@pytest.mark.asyncio
async def test_correction_receives_new_files_from_previous_attempt(
    tmp_path, monkeypatch
):
    requests = []

    class CorrectingAdapter:
        idempotent = True

        async def execute(self, request):
            requests.append(request)
            content = "incorrect" if request["attempt"] == 1 else "verified"
            return {
                "schema_version": "1.0",
                "files": {"src/result.txt": content},
                "usage": {"cost": 0, "tokens": 0},
                "summary": "controlled correction",
                "idempotency_key": request["idempotency_key"],
            }

    monkeypatch.setattr(
        engine_module, "adapter_for", lambda unit, config: CorrectingAdapter()
    )
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(adversarial_graph())["id"])
        assert run["state"] == "ACCEPTED"
        assert len(requests) == 2
        assert requests[1]["inputs"].get("src/result.txt") == "incorrect"
        assert requests[1]["correction"]["failure_class"] == "TEST_FAILURE"
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_correction_reports_actual_remaining_budget(tmp_path, monkeypatch):
    requests = []

    class BudgetAdapter:
        idempotent = True

        async def execute(self, request):
            requests.append(request)
            first = request["attempt"] == 1
            return {
                "schema_version": "1.0",
                "files": {"src/result.txt": "incorrect" if first else "verified"},
                "usage": {"cost": 0.7 if first else 0.1, "tokens": 60 if first else 10},
                "summary": "measured adapter fixture usage",
                "idempotency_key": request["idempotency_key"],
            }

    monkeypatch.setattr(
        engine_module, "adapter_for", lambda unit, config: BudgetAdapter()
    )
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(adversarial_graph())["id"])
        assert run["state"] == "ACCEPTED"
        assert requests[1]["budget"]["max_cost"] == pytest.approx(0.3)
        assert requests[1]["correction"]["remaining_budget"][
            "max_cost"
        ] == pytest.approx(0.3)
        assert requests[1]["correction"]["remaining_budget"]["max_tokens"] == 40
    finally:
        engine.close()


@pytest.mark.asyncio
async def test_binary_files_in_write_scope_do_not_crash_graph(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src/logo.bin").write_bytes(b"\x89PNG\xff\x00")
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(adversarial_graph())["id"])
        assert run["state"] == "ACCEPTED"
        assert (
            Path(run["workspace"]) / "src/logo.bin"
        ).read_bytes() == b"\x89PNG\xff\x00"
    finally:
        engine.close()


@pytest.mark.parametrize("value", ["'false'", "1", "[]", "{}"])
def test_process_authorization_config_requires_boolean(tmp_path, value):
    operational = tmp_path / ".lgo"
    operational.mkdir()
    (operational / "config.yaml").write_text(
        "schema_version: '1.0'\nconcurrency: 3\ncommands: {}\n"
        f"allow_process_agents: {value}\n"
    )
    with pytest.raises(PolicyError):
        load_config(tmp_path)


@pytest.mark.asyncio
async def test_invalidation_checks_all_active_nodes_before_rollback(tmp_path):
    graph = adversarial_graph()
    consumer = copy.deepcopy(graph["units"][0])
    consumer.update(
        id="consumer",
        task_id="1.2",
        inputs=["src/result.txt"],
        outputs=["consumer/output.txt"],
        dependencies=[
            {"unit": "writer", "reason": "Consumes the verified writer output"}
        ],
        file_scope=["consumer/**"],
        agent={
            "adapter": "mock",
            "attempts": [{"files": {"consumer/output.txt": "verified"}}],
        },
        verifiers=[
            {
                "kind": "file_contains",
                "path": "consumer/output.txt",
                "contains": "verified",
            }
        ],
    )
    graph["units"].append(consumer)
    engine = Engine(tmp_path, adversarial_config())
    try:
        run = await engine.execute(engine.start(graph)["id"])
        assert run["state"] == "ACCEPTED"
        run["nodes"]["consumer"]["state"] = "RUNNING"
        engine.store.save(run)
        writer_path = Path(run["workspace"]) / "src/result.txt"
        consumer_path = Path(run["workspace"]) / "consumer/output.txt"
        before = {str(p): p.read_bytes() for p in [writer_path, consumer_path]}
        with pytest.raises(PolicyError, match="Stop scheduler"):
            engine.invalidate(run["id"], "writer", "A consumer is still active")
        assert {str(p): p.read_bytes() for p in [writer_path, consumer_path]} == before
    finally:
        engine.close()


def test_operational_directory_symlink_cannot_redirect_controller_writes(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    project = tmp_path / "project"
    project.mkdir()
    (project / ".lgo").symlink_to(outside, target_is_directory=True)
    with pytest.raises(PolicyError, match="Symlink"):
        Engine(project, adversarial_config())
    assert not list(outside.iterdir())
