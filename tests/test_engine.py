from __future__ import annotations
import asyncio
import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import pytest
from lgo.engine import Engine
from lgo.graph import validate_graph, build_plan
from lgo.gates import GateEngine, ApprovalAuthority
from lgo.learning import LearningEngine
from lgo.merge import MergeCoordinator
from lgo.observability import report
from lgo.state import run_lock, StateStore
from lgo.util import PolicyError, digest, file_hash
from lgo.verification import VerificationEngine


def unit(uid, *, deps=(), attempts=None, scope=None, resources=(), risk="LOW"):
    path = f"src/{uid}.txt"
    return {
        "id": uid,
        "objective": f"Produce {uid}",
        "task_id": uid,
        "requirement_ids": [f"cap::{uid}"],
        "inputs": [],
        "outputs": [path],
        "dependencies": [
            {"unit": d, "reason": f"{d} provides required interface"} for d in deps
        ],
        "resources": list(resources),
        "file_scope": scope or [path],
        "acceptance": ["Content is ok"],
        "verifiers": [{"kind": "file_contains", "path": path, "contains": "ok"}],
        "agent": {
            "adapter": "mock",
            "attempts": attempts or [{"files": {path: "ok"}, "delay_seconds": 0.06}],
        },
        "risk": risk,
        "timeout_seconds": 2,
        "budget": {"max_cost": 1, "max_tokens": 1000},
        "max_attempts": 3,
    }


def graph(*units):
    return {
        "schema_version": "1.0",
        "change_id": "test-change",
        "spec_hash": digest("spec"),
        "units": list(units),
        "integration_verifiers": [v for u in units for v in u["verifiers"]],
    }


def config(**extra):
    return {"schema_version": "1.0", "concurrency": 3, "commands": {}, **extra}


@pytest.mark.parametrize(
    "mutator",
    [
        lambda g: g["units"][0]["dependencies"].append(
            {"unit": "absent", "reason": "missing"}
        ),
        lambda g: g["units"][0]["dependencies"].append(
            {"unit": "b", "reason": "cycle"}
        ),
        lambda g: g["units"][1]["dependencies"][0].update(reason=""),
        lambda g: g["units"].append(copy.deepcopy(g["units"][0])),
    ],
)
def test_graph_rejects_bad_edges_cycles_and_duplicates(mutator):
    g = graph(unit("a"), unit("b", deps=["a"]))
    mutator(g)
    with pytest.raises(PolicyError):
        validate_graph(g)


def test_plan_uses_source_traceability_and_not_task_order():
    a = unit("a")
    b = unit("b")
    model = {
        "id": "test-change",
        "spec_hash": digest("spec"),
        "artifacts": {},
        "tasks": [{"id": "b"}, {"id": "a"}],
        "requirements": [{"id": "cap::a"}, {"id": "cap::b"}],
    }
    g = build_plan(model, graph(a, b))
    assert all(not u["dependencies"] for u in g["units"])
    broken = copy.deepcopy(g)
    broken["units"][0]["task_id"] = "none"
    with pytest.raises(PolicyError, match="Unknown source task"):
        validate_graph(broken, model)
    model["requirements"].append({"id": "cap::uncovered"})
    with pytest.raises(PolicyError, match="Requirements without"):
        validate_graph(g, model)


def test_missing_artifact_dependency_and_conflict_rejected():
    a = unit("a")
    b = unit("b")
    b["inputs"] = ["src/a.txt"]
    with pytest.raises(PolicyError, match="missing dependency"):
        validate_graph(graph(a, b))
    b = unit("b", scope=["src/*"])
    with pytest.raises(PolicyError, match="write conflict"):
        validate_graph(graph(a, b))
    a["resources"] = ["src"]
    b["resources"] = ["src"]
    validate_graph(graph(a, b))


@pytest.mark.asyncio
async def test_real_parallel_dispatch_dependency_and_resource_lock(tmp_path):
    e = Engine(tmp_path, config())
    g = graph(unit("a"), unit("b"), unit("c"), unit("d", deps=["a", "b", "c"]))
    try:
        r = await e.execute(e.start(g)["id"])
        events = e.store.events(r["id"])
        metrics = report(e.store, r)
        assert r["state"] == "ACCEPTED"
        assert metrics["peak_workers"] == 3
        starts = {
            x["unit"]: x["timestamp"] for x in events if x["kind"] == "attempt_started"
        }
        finishes = {
            x["unit"]: x["timestamp"]
            for x in events
            if x["kind"] == "transition" and x["state"] == "PASSED"
        }
        assert max(starts[x] for x in ["a", "b", "c"]) < min(
            finishes[x] for x in ["a", "b", "c"]
        )
        assert starts["d"] >= max(finishes[x] for x in ["a", "b", "c"])
        assert not (tmp_path / "src").exists()  # isolated run never writes checkout
    finally:
        e.close()
    e = Engine(tmp_path / "locked", config())
    a = unit("a", resources=["db"])
    b = unit("b", resources=["db"])
    try:
        r = await e.execute(e.start(graph(a, b))["id"])
        events = e.store.events(r["id"])
        bstart = next(
            x["timestamp"]
            for x in events
            if x["kind"] == "attempt_started" and x["unit"] == "b"
        )
        aend = next(
            x["timestamp"]
            for x in events
            if x["kind"] == "transition" and x["unit"] == "a" and x["state"] == "PASSED"
        )
        assert bstart >= aend
    finally:
        e.close()


@pytest.mark.asyncio
async def test_correction_local_preserves_other_units_and_feedback(tmp_path):
    a = unit(
        "a",
        attempts=[{"files": {"src/a.txt": "wrong"}}, {"files": {"src/a.txt": "ok"}}],
    )
    e = Engine(tmp_path, config())
    try:
        r = await e.execute(e.start(graph(a, unit("b"), unit("c")))["id"])
        assert r["state"] == "ACCEPTED"
        assert {k: v["attempts"] for k, v in r["nodes"].items()} == {
            "a": 2,
            "b": 1,
            "c": 1,
        }
        corrections = [x for x in e.store.events(r["id"]) if x["kind"] == "correction"]
        assert len(corrections) == 1
        assert corrections[0]["feedback"]["remaining_attempts"] == 2
        assert corrections[0]["feedback"]["scope"]["allowed"] == ["src/a.txt"]
    finally:
        e.close()


@pytest.mark.asyncio
async def test_attempt_limit_and_no_progress_differ(tmp_path):
    for name, attempts, expected in [
        ("budget", [{"files": {"src/a.txt": str(i)}} for i in range(5)], 3),
        ("no-progress", [{"files": {"src/a.txt": "bad"}}], 2),
    ]:
        e = Engine(tmp_path / name, config())
        try:
            r = await e.execute(e.start(graph(unit("a", attempts=attempts)))["id"])
            assert r["state"] == "BLOCKED"
            assert r["nodes"]["a"]["attempts"] == expected
            assert r["nodes"]["a"]["state"] in ("FAILED", "BLOCKED")
        finally:
            e.close()


@pytest.mark.asyncio
async def test_timeout_does_not_retry_unchanged_environment(tmp_path):
    a = unit("a", attempts=[{"files": {}, "delay_seconds": 10}])
    a["timeout_seconds"] = 0.02
    e = Engine(tmp_path, config())
    try:
        r = await e.execute(e.start(graph(a))["id"])
        assert r["nodes"]["a"]["attempts"] == 1
        assert r["nodes"]["a"]["correction"]["failure_class"] == "ENVIRONMENT_FAILURE"
    finally:
        e.close()


@pytest.mark.asyncio
async def test_pause_resume_invalidates_only_transitive_consumers(tmp_path):
    e = Engine(tmp_path, config())
    g = graph(unit("a"), unit("b"), unit("c", deps=["a"]))
    try:
        r = await e.execute(e.start(g)["id"], stop_after=2)
        assert r["state"] == "PAUSED"
        assert r["nodes"]["a"]["state"] == r["nodes"]["b"]["state"] == "PASSED"
        rid = r["id"]
        e.close()
        e = Engine(tmp_path, config())
        r = await e.execute(rid)
        assert all(n["attempts"] == 1 for n in r["nodes"].values())
        r = e.invalidate(rid, "a", "Interface changed")
        assert r["nodes"]["b"]["state"] == "PASSED"
        assert r["nodes"]["c"]["state"] == "INVALIDATED"
        assert not (Path(r["workspace"]) / "src/a.txt").exists()
        r = await e.execute(rid)
        assert r["state"] == "ACCEPTED"
        assert r["nodes"]["b"]["attempts"] == 1
    finally:
        e.close()


@pytest.mark.asyncio
async def test_replan_failed_node_preserves_independent_success(tmp_path):
    a = unit("a", attempts=[{"files": {"src/a.txt": "bad"}}])
    e = Engine(tmp_path, config())
    try:
        r = await e.execute(e.start(graph(a, unit("b")))["id"])
        assert r["nodes"]["b"]["state"] == "PASSED"
        fixed = graph(unit("a"), unit("b"))
        r = e.replan(r["id"], fixed, "Replace failed implementation strategy")
        assert r["nodes"]["b"]["state"] == "PASSED"
        r = await e.execute(r["id"])
        assert r["state"] == "ACCEPTED"
        assert r["nodes"]["b"]["attempts"] == 1
    finally:
        e.close()


def test_merge_journal_replays_partial_commit_and_detects_divergence(tmp_path):
    w = tmp_path / "workspace"
    w.mkdir()
    (w / "a").write_text("old-a")
    (w / "b").write_text("old-b")
    base = {"a": file_hash(w / "a"), "b": file_hash(w / "b")}
    m = MergeCoordinator(w, tmp_path / "journal.json")
    result = m.integrate("writer", {"a": "new-a", "b": "new-b"}, base)
    assert result["originals"] == {"a": "old-a", "b": "old-b"}
    assert m.recover()["passed"]
    assert (w / "a").read_text() == "new-a"
    (w / "b").write_text("external")
    with pytest.raises(PolicyError, match="conflict"):
        m.recover()
    assert (w / "b").read_text() == "external"


@pytest.mark.asyncio
async def test_external_oracles_fail_and_unallowlisted_command_blocked(tmp_path):
    v = VerificationEngine(config())
    result = await v.check([{"kind": "command", "command": "untrusted"}], tmp_path)
    assert not result["passed"]
    assert result["results"][0]["failure_class"] == "POLICY_VIOLATION"
    (tmp_path / "bad.json").write_text('{"answer":false}')
    result = await v.check(
        [
            {
                "kind": "json_schema",
                "path": "bad.json",
                "schema": {"type": "object", "properties": {"answer": {"const": True}}},
            }
        ],
        tmp_path,
    )
    assert not result["passed"]
    v = VerificationEngine(
        config(
            commands={"fail": {"argv": [sys.executable, "-c", "raise SystemExit(7)"]}}
        )
    )
    result = await v.check([{"kind": "command", "command": "fail"}], tmp_path)
    assert result["results"][0]["evidence"]["exit_code"] == 7


@pytest.mark.asyncio
async def test_learning_needs_validated_runs_authority_and_regressions(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    key = tmp_path / "authority.key"
    key.write_bytes(os.urandom(32))
    key.chmod(0o600)
    authority = ApprovalAuthority(key, project)
    gate = GateEngine(authority)
    e = Engine(project, config(), gate)
    a = unit("a", scope=["backend/**"])
    a["outputs"] = ["backend/a"]
    a["verifiers"] = [{"kind": "file_contains", "path": "backend/a", "contains": "ok"}]
    a["agent"]["attempts"] = [
        {"files": {"backend/a": "bad"}},
        {"files": {"backend/a": "ok"}},
    ]
    try:
        incomplete = e.start(graph(a))
        learn = LearningEngine(e.store, gate)
        with pytest.raises(PolicyError):
            learn.propose(incomplete)
        r = await e.execute(incomplete["id"])
        candidate = learn.propose(r)[0]
        assert candidate["status"] == "PROPOSED"
        with pytest.raises(PolicyError):
            learn.promote(r, candidate["id"], {"approved": True}, [r["id"]])
        trial = copy.deepcopy(candidate)
        trial["status"] = "ACTIVE"
        model = {
            "id": "test-change",
            "spec_hash": digest("spec"),
            "artifacts": {},
            "tasks": [{"id": "a"}],
            "requirements": [{"id": "cap::a"}],
        }
        trial_graph = build_plan(model, graph(a), [trial])
        r2 = await e.execute(e.start(trial_graph)["id"])
        ids = sorted([r["id"], r2["id"]])
        binding = digest({"rule": candidate, "regressions": ids})
        token = authority.sign(
            {
                "binding": binding,
                "action": "promote-learning",
                "expires_at": time.time() + 60,
                "actor": "test-authority-only",
            }
        )
        active = learn.promote(r, candidate["id"], token, ids)
        assert active["status"] == "ACTIVE"
        model = {
            "id": "test-change",
            "spec_hash": digest("spec"),
            "artifacts": {},
            "tasks": [{"id": "a"}],
            "requirements": [{"id": "cap::a"}],
        }
        planned = build_plan(model, graph(a), e.store.rules())
        assert active["constraint"]["resource"] in planned["units"][0]["resources"]
        revoke = authority.sign(
            {
                "binding": digest(active),
                "action": "revoke-learning",
                "expires_at": time.time() + 60,
                "actor": "test-authority-only",
            }
        )
        learn.revoke(r, candidate["id"], revoke)
        assert not build_plan(model, graph(a), e.store.rules())["applied_rules"]
        assert [v["version"] for v in e.store.rule_history(candidate["id"])] == [
            1,
            2,
            3,
        ]
    finally:
        e.close()


@pytest.mark.asyncio
async def test_signed_delivery_checks_reviewed_hash_and_consumer_conflict(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    key = tmp_path / "key"
    key.write_bytes(os.urandom(32))
    key.chmod(0o600)
    authority = ApprovalAuthority(key, project)
    e = Engine(project, config(), GateEngine(authority))
    try:
        r = await e.execute(e.start(graph(unit("a")))["id"])
        assert (
            e.integrate_consumer(r["id"], {"approved": True})["verdict"]
            == "HUMAN_APPROVAL_REQUIRED"
        )
        request = e.gate.authorize(r, action="integrate")["approval_request"]
        token = authority.sign(
            {**request, "expires_at": time.time() + 60, "actor": "test-authority-only"}
        )
        assert e.integrate_consumer(r["id"], token)["integrated_into_consumer"]
        assert (project / "src/a.txt").read_text() == "ok"
    finally:
        e.close()


def test_single_writer_lock_rejects_second_scheduler(tmp_path):
    with run_lock(tmp_path):
        with pytest.raises(PolicyError):
            with run_lock(tmp_path):
                pass


@pytest.mark.asyncio
async def test_real_process_kill_and_resume_preserves_approved_unit(tmp_path):
    g = graph(
        unit("fast"),
        unit(
            "slow",
            deps=["fast"],
            attempts=[{"files": {"src/slow.txt": "ok"}, "delay_seconds": 1.5}],
        ),
    )
    plan = tmp_path / "plan.json"
    plan.write_text(json.dumps(g))
    code = "import asyncio,json,sys;from pathlib import Path;from lgo.engine import Engine;e=Engine(Path(sys.argv[1]),{'schema_version':'1.0','concurrency':3,'commands':{}});r=e.start(json.loads((Path(sys.argv[1])/'plan.json').read_text()));asyncio.run(e.execute(r['id']))"
    proc = subprocess.Popen(
        [sys.executable, "-c", code, str(tmp_path)],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    run_id = None
    try:
        deadline = time.time() + 8
        while time.time() < deadline:
            if (tmp_path / ".lgo/state.sqlite").exists():
                store = StateStore(tmp_path / ".lgo")
                r = store.latest("test-change")
                store.close()
                if (
                    r
                    and r["nodes"]["fast"]["state"] == "PASSED"
                    and r["nodes"]["slow"]["state"] == "RUNNING"
                ):
                    run_id = r["id"]
                    break
            await asyncio.sleep(0.02)
        assert run_id, "Did not observe persisted mid-flight checkpoint"
        proc.kill()
        proc.wait(timeout=3)
        e = Engine(tmp_path, config())
        try:
            r = await e.execute(run_id)
            assert r["state"] == "ACCEPTED"
            assert r["nodes"]["fast"]["attempts"] == 1
            assert r["nodes"]["slow"]["attempts"] == 2
            assert any(x["kind"] == "recovered_retry" for x in e.store.events(run_id))
        finally:
            e.close()
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=3)


@pytest.mark.asyncio
async def test_policy_can_raise_risk_and_reject_oversized_blast_radius(tmp_path):
    operational = tmp_path / ".lgo"
    operational.mkdir()
    (operational / "policies.yaml").write_text(
        "schema_version: '1.0'\nhigh_risk_paths: ['src/a.txt']\nmax_files_per_patch: 1\n"
    )
    e = Engine(tmp_path, config())
    try:
        r = await e.execute(e.start(graph(unit("a")))["id"])
        assert (
            r["nodes"]["a"]["state"] == "WAITING_APPROVAL"
            and r["nodes"]["a"]["attempts"] == 0
        )
    finally:
        e.close()


def test_planner_derives_edges_from_declared_artifacts():
    a = unit("a")
    b = unit("b")
    b["inputs"] = ["src/a.txt"]
    model = {
        "id": "test-change",
        "spec_hash": digest("spec"),
        "artifacts": {},
        "tasks": [{"id": "a"}, {"id": "b"}],
        "requirements": [{"id": "cap::a"}, {"id": "cap::b"}],
    }
    planned = build_plan(model, graph(a, b))
    edge = planned["units"][1]["dependencies"][0]
    assert edge["unit"] == "a" and "src/a.txt" in edge["reason"]


@pytest.mark.asyncio
async def test_configured_oracle_cannot_be_modified_by_worker(tmp_path):
    (tmp_path / "src").mkdir()
    (tmp_path / "src/test.txt").write_text("frozen")
    a = unit(
        "a",
        scope=["src/**"],
        attempts=[{"files": {"src/a.txt": "ok", "src/test.txt": "bypassed"}}],
    )
    e = Engine(tmp_path, config(protected_paths=["src/test.txt"]))
    try:
        r = await e.execute(e.start(graph(a))["id"])
        assert r["state"] == "BLOCKED"
        assert (Path(r["workspace"]) / "src/test.txt").read_text() == "frozen"
    finally:
        e.close()
