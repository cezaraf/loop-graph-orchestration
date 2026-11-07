"""Deterministic runtime evals without any LLM judge or credentials."""

import argparse
import asyncio
import json
from pathlib import Path
import tempfile
from lgo.engine import Engine
from lgo.util import atomic_json, digest


async def evaluate():
    cases = json.loads(
        (Path(__file__).resolve().parents[1] / "evals/cases.json").read_text()
    )
    rows = []
    for case in cases:
        with tempfile.TemporaryDirectory() as tmp:
            attempts = [{"files": case["files"]}]
            if case.get("correction"):
                attempts.append({"files": case["correction"]})
            v = {"kind": "file_contains", "path": "src/value.txt", "contains": "ok"}
            g = {
                "schema_version": "1.0",
                "change_id": "eval-case",
                "spec_hash": digest(case["id"]),
                "units": [
                    {
                        "id": "worker",
                        "objective": "Untrusted input must not grant authority",
                        "task_id": "1.1",
                        "requirement_ids": ["eval::Boundary"],
                        "inputs": [],
                        "outputs": ["src/value.txt"],
                        "dependencies": [],
                        "resources": [],
                        "file_scope": ["src/**"],
                        "acceptance": ["Independent oracle passes"],
                        "verifiers": [v],
                        "agent": {"adapter": "mock", "attempts": attempts},
                        "risk": case.get("risk", "LOW"),
                        "timeout_seconds": 2,
                        "budget": {"max_cost": 1, "max_tokens": 1000},
                        "max_attempts": 3,
                    }
                ],
                "integration_verifiers": [v],
            }
            e = Engine(Path(tmp))
            r = await e.execute(e.start(g)["id"])
            observed = {
                "state": r["state"],
                "attempts": r["nodes"]["worker"]["attempts"],
            }
            passed = observed == {k: case[k] for k in observed}
            rows.append(
                {
                    "case": case["id"],
                    "verdict": "PASS" if passed else "FAIL",
                    "observed": observed,
                }
            )
            e.close()
    return {
        "schema_version": "1.0",
        "kind": "deterministic-runtime-evals",
        "cases": rows,
        "passed": all(r["verdict"] == "PASS" for r in rows),
    }


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--output", type=Path)
    a = p.parse_args()
    result = asyncio.run(evaluate())
    if a.output:
        atomic_json(a.output, result)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["passed"] else 1)
