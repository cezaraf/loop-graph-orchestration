#!/usr/bin/env python3
"""Real OpenSpec -> parallel mock workers -> correction -> durable resume.

No authority is forged; consumer delivery/archive remains blocked for review.
"""

from __future__ import annotations
import argparse
import asyncio
import copy
import json
from pathlib import Path
import shutil
from lgo.engine import Engine, copy_workspace
from lgo.graph import build_plan, mermaid
from lgo.learning import LearningEngine
from lgo.observability import report
from lgo.openspec import OpenSpecAdapter
from lgo.util import atomic_json


async def demo(output):
    source = Path(__file__).resolve().parents[1] / "examples/tipo-exame"
    output = output.resolve()
    if output.exists():
        raise ValueError(
            "Use um diretório de saída novo; demonstração não sobrescreve arquivos."
        )
    project = output / "consumer"
    project.mkdir(parents=True)
    copy_workspace(source, project)
    (project / ".lgo/bindings").mkdir(parents=True)
    shutil.copy2(source / ".lgo/config.yaml", project / ".lgo/config.yaml")
    bindings = json.loads((source / ".lgo/plans/add-tipo-exame.json").read_text())
    bindings.pop("spec_hash", None)
    atomic_json(project / ".lgo/bindings/add-tipo-exame.json", bindings)
    # Preserve externally owned test fixtures; workers generate actual app files.
    for unit in bindings["units"]:
        if unit["id"] not in ("contract", "backend", "frontend"):
            continue
        for path in unit["outputs"]:
            if "/src/test/" not in path:
                (project / path).unlink(missing_ok=True)
    adapter = OpenSpecAdapter(project)
    model = adapter.load("add-tipo-exame")
    graph = build_plan(model, bindings)
    atomic_json(project / ".lgo/plans/add-tipo-exame.json", graph)
    (output / "graph.mmd").write_text(mermaid(graph) + "\n")
    engine = Engine(project)
    run = engine.start(graph)
    run = await engine.execute(run["id"], stop_after=3)
    assert run["state"] == "PAUSED", run["state"]
    before = {
        uid: n["attempts"] for uid, n in run["nodes"].items() if n["state"] == "PASSED"
    }
    run_id = run["id"]
    engine.close()  # process/store boundary; also tested with SIGKILL in suite
    engine = Engine(project)
    run = await engine.execute(run_id)
    assert run["state"] == "ACCEPTED", json.dumps(run["nodes"])
    assert all(
        run["nodes"][uid]["attempts"] == attempts for uid, attempts in before.items()
    )
    assert run["nodes"]["backend"]["attempts"] == 2
    run = await engine.verify(run_id)
    candidates = LearningEngine(engine.store, engine.gate).propose(run)
    high = copy.deepcopy(graph)
    high["units"][0]["risk"] = "HIGH"
    high_run = engine.start(high)
    high_run = await engine.execute(high_run["id"])
    assert high_run["nodes"]["contract"]["state"] == "WAITING_APPROVAL"
    assert high_run["nodes"]["contract"]["attempts"] == 0
    assert candidates and candidates[0]["status"] == "PROPOSED"
    # Preview a candidate's planning consequence without promoting it or changing policy.
    preview = copy.deepcopy(candidates[0])
    preview.update(status="ACTIVE", version=2)
    what_if = build_plan(model, bindings, [preview])
    assert what_if["applied_rules"]
    approval = engine.gate.authorize(run, action="archive")
    archive = adapter.prepare_archive(
        "add-tipo-exame", all_accepted=True, integration_passed=True, gate_passed=False
    )
    archive["authority_gate"] = approval
    archive["delivery"] = engine.delivery_status(run)
    assert not archive["ready"]
    # Consumers are still empty; no checkboxes can claim unpublished app completion.
    progress = adapter.sync_tasks(
        "add-tipo-exame", [], expected_spec_hash=model["spec_hash"]
    )
    assert not any(t["checked"] for t in adapter.load("add-tipo-exame")["tasks"])
    metrics = report(engine.store, run)
    assert metrics["peak_workers"] >= 3
    result = {
        "schema_version": "1.0",
        "run_id": run_id,
        "metrics": metrics,
        "verified_recovery": {
            "before": before,
            "after": {uid: run["nodes"][uid]["attempts"] for uid in before},
        },
        "corrections": [
            e for e in engine.store.events(run_id) if e["kind"] == "correction"
        ],
        "risk_gate": high_run["gates"],
        "archive_preparation": archive,
        "progress_sync": progress,
        "learning": {
            "candidates": candidates,
            "promotion": "NOT_AUTHORIZED",
            "what_if_only": True,
            "preview_resources": {u["id"]: u["resources"] for u in what_if["units"]},
        },
        "consumer_project": str(project),
        "workspace": run["workspace"],
        "limits": [
            "Mock adapters; no LLM use or token/cost measurement",
            "Offline graph oracles; real Maven/Angular validation is recorded separately",
            "No consumer integration, spec sync or archive without external authority",
            "Learning preview is not an approved global rule",
        ],
    }
    atomic_json(output / "demo-report.json", result)
    engine.close()
    return result


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path, required=True)
    a = p.parse_args()
    result = asyncio.run(demo(a.output))
    print(
        json.dumps(
            {
                "run_id": result["run_id"],
                "state": result["metrics"]["state"],
                "report": str(a.output / "demo-report.json"),
                "peak_workers": result["metrics"]["peak_workers"],
                "attempts": result["metrics"]["attempts"],
            },
            indent=2,
        )
    )
