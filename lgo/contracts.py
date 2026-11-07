"""Harness-neutral JSON Schema 2020-12 execution contracts, version 1.0.

The JSON files under schemas/ are generated from SCHEMAS. Minor extensions must
be additive and opt-in; unknown versions fail closed. Adapter-specific settings
are the explicit extension point, not a second product specification format.
"""

from __future__ import annotations
from copy import deepcopy
from jsonschema import Draft202012Validator

S = {"type": "string", "minLength": 1}
STRINGS = {"type": "array", "items": S, "uniqueItems": True}
NONEMPTY = {**STRINGS, "minItems": 1}
N = {"type": "number", "minimum": 0}
INTEGER_SCHEMA = {"type": "integer", "minimum": 0}
B = {"type": "boolean"}
VERDICTS = ["PASS", "FAIL", "RETRY", "REPLAN", "BLOCKED", "HUMAN_APPROVAL_REQUIRED"]
STATES = [
    "PENDING",
    "READY",
    "RUNNING",
    "VERIFYING",
    "PASSED",
    "FAILED",
    "RETRYING",
    "BLOCKED",
    "INVALIDATED",
    "CANCELLED",
    "WAITING_APPROVAL",
]
HASH = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
PATH = {
    "type": "string",
    "minLength": 1,
    "pattern": r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))(?!.*\\).+$",
}
MAP = {"type": "object"}


def obj(properties, required=None, *, version=False, extra=False):
    props = deepcopy(properties)
    if version:
        props = {"schema_version": {"const": "1.0"}, **props}
    return {
        "type": "object",
        "properties": props,
        "required": list(props)
        if required is None
        else (["schema_version"] if version else []) + list(required),
        "additionalProperties": extra,
    }


def array(item, minimum=0):
    return {"type": "array", "items": item, "minItems": minimum}


BUDGET = obj({"max_cost": N, "max_tokens": INTEGER_SCHEMA})
DEPENDENCY = obj({"unit": S, "reason": S})
VERIFIER = {
    "oneOf": [
        obj(
            {
                "kind": {"const": "command"},
                "command": S,
                "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
            },
            ["kind", "command"],
        ),
        obj({"kind": {"const": "file_contains"}, "path": PATH, "contains": S}),
        {
            **obj(
                {
                    "kind": {"const": "json_schema"},
                    "path": PATH,
                    "schema": MAP,
                    "schema_path": PATH,
                },
                ["kind", "path"],
            ),
            "anyOf": [{"required": ["schema"]}, {"required": ["schema_path"]}],
        },
        obj({"kind": {"const": "equal_files"}, "left": PATH, "right": PATH}),
        obj({"kind": {"const": "ci"}, "check": S, "revision": S}),
        obj({"kind": {"const": "no_duplicates"}, "path": PATH}),
        obj({"kind": {"const": "human"}}),
    ]
}
AGENT = obj(
    {"adapter": S, "profile": S, "attempts": array(MAP), "config": MAP},
    ["adapter"],
    extra=True,
)
SCENARIO = obj({"name": {"type": "string"}, "rawText": S}, ["rawText"])
REQ = obj(
    {
        "id": S,
        "name": S,
        "text": S,
        "scenarios": array(SCENARIO),
        "capability": S,
        "operation": {"enum": ["ADDED", "MODIFIED", "REMOVED", "RENAMED"]},
        "rename": obj({"from": S, "to": S}),
    },
    ["id", "name", "text", "scenarios", "capability", "operation"],
)
TASK = obj(
    {
        "id": S,
        "official_id": S,
        "text": S,
        "checked": B,
        "sourcePath": S,
        "line": {"type": "integer", "minimum": 1},
    },
    ["id", "text", "checked"],
)
ACCEPTANCE = obj(
    {"id": S, "requirement_id": S, "observable": S, "verifiers": array(VERIFIER, 1)},
    version=True,
)
WORK = obj(
    {
        "id": {"type": "string", "pattern": "^[a-zA-Z0-9_-]+$"},
        "objective": S,
        "task_id": S,
        "requirement_ids": NONEMPTY,
        "inputs": STRINGS,
        "outputs": STRINGS,
        "dependencies": array(DEPENDENCY),
        "resources": STRINGS,
        "file_scope": array(PATH, 1),
        "acceptance": NONEMPTY,
        "verifiers": array(VERIFIER, 1),
        "agent": AGENT,
        "risk": {"enum": ["LOW", "MEDIUM", "HIGH"]},
        "timeout_seconds": {"type": "number", "exclusiveMinimum": 0},
        "budget": BUDGET,
        "max_attempts": {"type": "integer", "minimum": 1, "maximum": 10},
        "priority": {"type": "integer"},
    },
    [
        "id",
        "objective",
        "task_id",
        "requirement_ids",
        "inputs",
        "outputs",
        "dependencies",
        "resources",
        "file_scope",
        "acceptance",
        "verifiers",
        "agent",
        "risk",
        "timeout_seconds",
        "budget",
        "max_attempts",
    ],
)
RULE = obj({"id": S, "version": {"type": "integer", "minimum": 1}})

SCHEMAS = {
    "openspec_change_reference": obj(
        {
            "change_id": {"type": "string", "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"},
            "root": S,
            "schema": {"const": "spec-driven"},
            "openspec_version": {"const": "1.16.1"},
            "spec_hash": HASH,
        },
        version=True,
    ),
    "parsed_specification": obj(
        {
            "id": S,
            "schema": {"const": "spec-driven"},
            "openspec_version": {"const": "1.16.1"},
            "metadata": MAP,
            "tasks": array(TASK),
            "requirements": array(REQ),
            "capabilities": STRINGS,
            "artifacts": {"type": "object", "additionalProperties": HASH},
            "spec_hash": HASH,
            "planning_status": MAP,
            "proposal": S,
            "design": {"type": ["string", "null"]},
        },
        version=True,
    ),
    "requirement": obj(REQ["properties"], REQ["required"], version=True),
    "acceptance_criterion": ACCEPTANCE,
    "work_unit": obj(WORK["properties"], WORK["required"], version=True),
    "execution_graph": obj(
        {
            "change_id": S,
            "spec_hash": HASH,
            "units": array(WORK, 1),
            "integration_verifiers": array(VERIFIER),
            "external_inputs": STRINGS,
            "applied_rules": array(RULE),
            "metadata": MAP,
        },
        ["change_id", "spec_hash", "units", "integration_verifiers"],
        version=True,
    ),
    "agent_request": obj(
        {
            "run_id": S,
            "unit_id": S,
            "attempt": {"type": "integer", "minimum": 1},
            "objective": S,
            "allowed_scope": array(PATH, 1),
            "requirements": NONEMPTY,
            "inputs": {"type": "object", "additionalProperties": {"type": "string"}},
            "budget": BUDGET,
            "idempotency_key": S,
            "correction": {"type": ["object", "null"]},
            "instruction": S,
        },
        version=True,
    ),
    "agent_result": obj(
        {
            "files": {
                "type": "object",
                "propertyNames": PATH,
                "additionalProperties": {"type": ["string", "null"]},
            },
            "usage": obj({"cost": N, "tokens": INTEGER_SCHEMA}),
            "summary": {"type": "string"},
            "idempotency_key": S,
        },
        version=True,
    ),
    "verification_result": obj(
        {
            "kind": S,
            "passed": B,
            "failure_class": {
                "enum": [
                    None,
                    "TEST_FAILURE",
                    "TRANSIENT_FAILURE",
                    "ENVIRONMENT_FAILURE",
                    "POLICY_VIOLATION",
                ]
            },
            "evidence": MAP,
            "duration_seconds": N,
        },
        version=True,
    ),
    "correction_request": obj(
        {
            "unit_id": S,
            "verdict": {"enum": ["FAIL", "RETRY", "REPLAN", "BLOCKED"]},
            "failure_class": {
                "enum": [
                    "TEST_FAILURE",
                    "TRANSIENT_FAILURE",
                    "ENVIRONMENT_FAILURE",
                    "POLICY_VIOLATION",
                    "PLANNING_FAILURE",
                    "SPECIFICATION_FAILURE",
                ]
            },
            "reason": S,
            "evidence": array(MAP, 1),
            "scope": obj({"allowed": array(PATH, 1), "forbidden": STRINGS}),
            "remaining_attempts": INTEGER_SCHEMA,
            "remaining_budget": BUDGET,
            "next_action": {"enum": ["CORRECT", "REPLAN"]},
        },
        version=True,
    ),
    "merge_result": obj(
        {
            "unit": S,
            "passed": B,
            "status": {"enum": ["COMMITTED", "CONFLICT", "ROLLED_BACK", "BLOCKED"]},
            "files": STRINGS,
            "hashes": {
                "type": "object",
                "propertyNames": PATH,
                "additionalProperties": {"anyOf": [HASH, {"type": "null"}]},
            },
            "originals": {
                "type": "object",
                "propertyNames": PATH,
                "additionalProperties": {"type": ["string", "null"]},
            },
        },
        ["unit", "passed", "status", "files", "hashes"],
        version=True,
    ),
    "gate_decision": obj(
        {
            "unit": {"type": ["string", "null"]},
            "verdict": {"enum": VERDICTS},
            "reason": S,
            "policy": S,
            "evidence": array({"type": ["object", "string", "null"]}),
            "next_action": S,
            "approval_request": obj(
                {
                    "binding": HASH,
                    "action": S,
                    "run_id": S,
                    "unit": {"type": ["string", "null"]},
                }
            ),
        },
        ["unit", "verdict", "reason", "policy", "evidence", "next_action"],
        version=True,
    ),
    "approval_request": obj(
        {
            "binding": HASH,
            "action": S,
            "run_id": S,
            "unit": {"type": ["string", "null"]},
        },
        version=True,
    ),
    "execution_event": obj(
        {
            "run_id": S,
            "timestamp": N,
            "kind": S,
            "unit": S,
            "graph_hash": HASH,
            "state": S,
            "old": S,
            "reason": S,
            "integrated": B,
            "verified": B,
            "attempt": {"type": "integer", "minimum": 1},
            "idempotency_key": S,
            "active_workers": INTEGER_SCHEMA,
            "resources": STRINGS,
            "decision": MAP,
            "passed": B,
            "results": MAP,
            "result": MAP,
            "feedback": MAP,
            "units": STRINGS,
            "affected": STRINGS,
            "preserved": STRINGS,
            "candidate": S,
            "version": {"type": "integer", "minimum": 1},
            "finished_at": N,
            "ready_at": N,
            "started_at": N,
        },
        ["run_id", "timestamp", "kind"],
        version=True,
    ),
    "learning_candidate": obj(
        {
            "id": S,
            "finding": S,
            "root_cause": S,
            "kind": {"const": "resource_constraint"},
            "constraint": obj({"scope": PATH, "resource": S}),
            "target": S,
            "category": {
                "enum": [
                    "Constraint",
                    "Rule",
                    "Skill",
                    "Eval",
                    "Regression",
                    "Template",
                    "Runbook",
                    "Planning",
                ]
            },
            "status": {
                "enum": ["PROPOSED", "APPROVED", "ACTIVE", "REJECTED", "REVOKED"]
            },
            "evidence": obj(
                {
                    "run_id": S,
                    "evidence_digest": HASH,
                    "corrections": {"type": "integer", "minimum": 1},
                }
            ),
            "applicability": S,
            "regressions": STRINGS,
            "revoked": B,
            "version": {"type": "integer", "minimum": 1},
            "approval_actor": S,
        },
        [
            "id",
            "finding",
            "root_cause",
            "kind",
            "constraint",
            "target",
            "category",
            "status",
            "evidence",
            "applicability",
            "regressions",
            "revoked",
            "version",
        ],
        version=True,
    ),
    "execution_manifest": obj(
        {
            "id": S,
            "graph": MAP,
            "graph_hash": HASH,
            "policy_hash": HASH,
            "source_fingerprint": HASH,
            "state": {
                "enum": [
                    "PENDING",
                    "RUNNING",
                    "PAUSED",
                    "PASSED",
                    "FAILED",
                    "BLOCKED",
                    "CANCELLED",
                    "WAITING_APPROVAL",
                    "ACCEPTED",
                ]
            },
            "nodes": {
                "type": "object",
                "additionalProperties": obj(
                    {
                        "state": {"enum": STATES},
                        "attempts": INTEGER_SCHEMA,
                        "history": array(MAP),
                        "cost": N,
                        "tokens": INTEGER_SCHEMA,
                        "integrated": B,
                        "verified": B,
                        "merge": MAP,
                        "correction": MAP,
                        "pending_patch": MAP,
                        "last_evidence": S,
                        "reason": S,
                        "finished_at": N,
                        "ready_at": N,
                        "started_at": N,
                    },
                    ["state", "attempts", "history", "cost", "tokens", "integrated"],
                ),
            },
            "created_at": N,
            "updated_at": N,
            "workspace": S,
            "source_snapshot": {"type": "object", "additionalProperties": HASH},
            "integration": obj({"passed": B, "results": array(MAP)}, ["passed"]),
            "gates": array(MAP),
            "evidence_digest": HASH,
        },
        [
            "id",
            "graph",
            "graph_hash",
            "policy_hash",
            "source_fingerprint",
            "state",
            "nodes",
            "created_at",
            "workspace",
            "integration",
            "gates",
        ],
        version=True,
    ),
}
# Structured nested payloads share precisely the same contracts as direct messages.
SCHEMAS["agent_request"]["properties"]["correction"] = {
    "anyOf": [deepcopy(SCHEMAS["correction_request"]), {"type": "null"}]
}
SCHEMAS["execution_manifest"]["properties"]["graph"] = deepcopy(
    SCHEMAS["execution_graph"]
)
SCHEMAS["execution_manifest"]["properties"]["gates"]["items"] = deepcopy(
    SCHEMAS["gate_decision"]
)
SCHEMAS["execution_manifest"]["properties"]["nodes"]["additionalProperties"][
    "properties"
]["merge"] = deepcopy(SCHEMAS["merge_result"])
SCHEMAS["execution_manifest"]["properties"]["nodes"]["additionalProperties"][
    "properties"
]["correction"] = deepcopy(SCHEMAS["correction_request"])
for name, schema in SCHEMAS.items():
    schema.update(
        {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "$id": f"https://lgo.local/contracts/1.0/{name}.schema.json",
            "title": name,
        }
    )


def validate_contract(name, value):
    """Raise jsonschema.ValidationError on malformed or unknown contract versions."""
    if name not in SCHEMAS:
        raise ValueError(f"Unknown contract: {name}")
    Draft202012Validator(SCHEMAS[name]).validate(value)
    return value


validate = validate_contract


def export_schemas(destination):
    import json
    from pathlib import Path

    root = Path(destination)
    root.mkdir(parents=True, exist_ok=True)
    for name, schema in SCHEMAS.items():
        (root / f"{name}.schema.json").write_text(
            json.dumps(schema, indent=2, ensure_ascii=False) + "\n"
        )
