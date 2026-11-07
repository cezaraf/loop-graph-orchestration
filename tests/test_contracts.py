import copy
import json
from pathlib import Path
import pytest
from jsonschema import Draft202012Validator, ValidationError
from lgo.contracts import SCHEMAS, validate_contract

ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("name", SCHEMAS)
def test_contract_schema_and_valid_invalid_examples(name):
    schema = SCHEMAS[name]
    Draft202012Validator.check_schema(schema)
    assert json.loads((ROOT / "schemas" / f"{name}.schema.json").read_text()) == schema
    examples = json.loads((ROOT / "schemas" / "examples" / f"{name}.json").read_text())
    validate_contract(name, examples["valid"])
    with pytest.raises(ValidationError):
        validate_contract(name, examples["invalid"])
    for key in schema["required"]:
        bad = copy.deepcopy(examples["valid"])
        bad.pop(key)
        with pytest.raises(ValidationError):
            validate_contract(name, bad)
    bad = copy.deepcopy(examples["valid"])
    bad["schema_version"] = "2.0"
    with pytest.raises(ValidationError):
        validate_contract(name, bad)
    bad = copy.deepcopy(examples["valid"])
    bad["unrecognized_security_field"] = True
    with pytest.raises(ValidationError):
        validate_contract(name, bad)


def test_structured_scope_and_budget_reject_escape_and_negative():
    unit = json.loads((ROOT / "schemas/examples/work_unit.json").read_text())["valid"]
    for scope in ["../secrets", "/etc/passwd", "src/../../secrets", r"src\foo"]:
        bad = copy.deepcopy(unit)
        bad["file_scope"] = [scope]
        with pytest.raises(ValidationError):
            validate_contract("work_unit", bad)
    bad = copy.deepcopy(unit)
    bad["budget"]["max_cost"] = -1
    with pytest.raises(ValidationError):
        validate_contract("work_unit", bad)
    bad = copy.deepcopy(unit)
    bad["max_attempts"] = 0
    with pytest.raises(ValidationError):
        validate_contract("work_unit", bad)


def test_contracts_accept_real_execution_messages_and_reject_tampering(
    tmp_path, monkeypatch
):
    """Exercise wire interoperability against real producers, not re-created payloads."""
    import asyncio
    from lgo.adapters import MockAgentAdapter
    from lgo.engine import Engine
    from lgo.learning import LearningEngine

    requests = []
    responses = []
    original = MockAgentAdapter.execute

    async def capture(self, request):
        validate_contract("agent_request", request)
        requests.append(copy.deepcopy(request))
        result = await original(self, request)
        validate_contract("agent_result", result)
        responses.append(copy.deepcopy(result))
        return result

    monkeypatch.setattr(MockAgentAdapter, "execute", capture)
    graph = {
        "schema_version": "1.0",
        "change_id": "contract-demo",
        "spec_hash": "0" * 64,
        "units": [
            {
                "id": "response",
                "objective": "Write verified response",
                "task_id": "1.1",
                "requirement_ids": ["demo::Response"],
                "inputs": [],
                "outputs": ["answer.txt"],
                "dependencies": [],
                "resources": [],
                "file_scope": ["answer.txt"],
                "acceptance": ["Answer equals expected marker"],
                "verifiers": [
                    {
                        "kind": "file_contains",
                        "path": "answer.txt",
                        "contains": "verified",
                    }
                ],
                "agent": {
                    "adapter": "mock",
                    "profile": "contract-test",
                    "attempts": [
                        {"files": {"answer.txt": "incorrect"}},
                        {"files": {"answer.txt": "verified"}},
                    ],
                },
                "risk": "LOW",
                "timeout_seconds": 5,
                "budget": {"max_cost": 1, "max_tokens": 100},
                "max_attempts": 3,
            }
        ],
        "integration_verifiers": [
            {"kind": "file_contains", "path": "answer.txt", "contains": "verified"}
        ],
    }
    validate_contract("execution_graph", graph)
    engine = Engine(
        tmp_path, config={"schema_version": "1.0", "concurrency": 1, "commands": {}}
    )
    try:
        run = engine.start(graph)
        validate_contract("execution_manifest", run)
        run = asyncio.run(engine.execute(run["id"]))
        assert run["state"] == "ACCEPTED" and len(requests) == 2
        validate_contract("execution_manifest", run)
        for result in run["integration"]["results"]:
            validate_contract("verification_result", result)
        for node in run["nodes"].values():
            validate_contract("correction_request", node["correction"])
            validate_contract("merge_result", node["merge"])
            for history in node["history"]:
                for result in history["verification"]["results"]:
                    validate_contract("verification_result", result)
        for event in engine.store.events(run["id"]):
            validate_contract("execution_event", event)
        for gate in run["gates"]:
            validate_contract("gate_decision", gate)
        for candidate in LearningEngine(engine.store, engine.gate).propose(run):
            validate_contract("learning_candidate", candidate)
        bad = copy.deepcopy(responses[-1])
        bad["usage"]["tokens"] = -10
        with pytest.raises(ValidationError):
            validate_contract("agent_result", bad)
        bad = copy.deepcopy(requests[-1])
        bad["allowed_scope"] = ["../secret"]
        with pytest.raises(ValidationError):
            validate_contract("agent_request", bad)
    finally:
        engine.close()
