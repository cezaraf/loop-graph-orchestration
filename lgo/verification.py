from __future__ import annotations
import asyncio
import json
import time
from jsonschema import Draft202012Validator
from .adapters import process
from .util import safe_path, file_hash, digest, PolicyError, snapshot


class OracleBuilder:
    """Bind observed acceptance criteria to explicit, operator-owned oracles.

    Natural-language scenarios are never claimed automatically executable.
    Missing deterministic bindings block graph validation.
    """

    @staticmethod
    def coverage(model, graph):
        return {
            r["id"]: [
                {"unit": u["id"], "checks": u["verifiers"]}
                for u in graph["units"]
                if r["id"] in u["requirement_ids"]
            ]
            for r in model["requirements"]
        }


class VerificationEngine:
    def __init__(self, config):
        self.config = config

    async def check(self, verifiers, workspace):
        results = []
        for v in verifiers:
            started = time.time()
            kind = v.get("kind")
            evidence = {}
            try:
                if kind == "command":
                    command = self.config.get("commands", {}).get(v["command"])
                    if not command:
                        raise PolicyError(f"Command not allowlisted: {v['command']}")
                    before = snapshot(workspace)
                    code, out, err = await process(
                        command["argv"],
                        cwd=workspace,
                        timeout=command.get("timeout_seconds", 30),
                    )
                    evidence = {
                        "exit_code": code,
                        "stdout": out,
                        "stderr": err,
                        "command": v["command"],
                    }
                    # Trusted commands may produce only explicitly declared generated artifacts.
                    after = snapshot(workspace)
                    changes = [
                        p
                        for p in before.keys() | after.keys()
                        if before.get(p) != after.get(p)
                    ]
                    from .util import matches

                    unexpected = [
                        p
                        for p in changes
                        if not matches(p, command.get("write_scope", []))
                    ]
                    if unexpected:
                        raise PolicyError(
                            f"Oracle modified undeclared files: {unexpected}"
                        )
                    passed = code == 0
                elif kind == "file_contains":
                    p = safe_path(workspace, v["path"])
                    actual = p.read_text() if p.exists() else ""
                    passed = v["contains"] in actual
                    evidence = {
                        "path": v["path"],
                        "expected_contains": v["contains"],
                        "actual_sha256": file_hash(p),
                    }
                elif kind == "json_schema":
                    data = json.loads(safe_path(workspace, v["path"]).read_text())
                    schema = v.get("schema")
                    if not schema and v.get("schema_path"):
                        schema = json.loads(
                            safe_path(workspace, v["schema_path"]).read_text()
                        )
                    Draft202012Validator.check_schema(schema)

                    # Remote refs are disallowed; no schema-triggered network fetch.
                    def refs(obj):
                        if isinstance(obj, dict):
                            if any(
                                k in obj and not obj[k].startswith("#")
                                for k in ("$ref", "$dynamicRef")
                            ):
                                raise PolicyError("External JSON Schema refs disabled")
                            for val in obj.values():
                                refs(val)
                        elif isinstance(obj, list):
                            for val in obj:
                                refs(val)

                    refs(schema)
                    issues = [
                        e.message
                        for e in Draft202012Validator(schema).iter_errors(data)
                    ]
                    passed = not issues
                    evidence = {"errors": issues, "path": v["path"]}
                elif kind == "equal_files":
                    left = safe_path(workspace, v["left"])
                    right = safe_path(workspace, v["right"])
                    passed = (
                        left.is_file()
                        and right.is_file()
                        and left.read_bytes() == right.read_bytes()
                    )
                    evidence = {"left": file_hash(left), "right": file_hash(right)}
                elif kind == "no_duplicates":
                    values = json.loads(safe_path(workspace, v["path"]).read_text())
                    passed = len(values) == len({digest(x) for x in values})
                    evidence = {"count": len(values)}
                elif kind == "ci":
                    # CI proof must be host-fed evidence pinned to the reviewed revision.
                    report = self.config.get("ci_results", {}).get(v["check"])
                    passed = bool(
                        report
                        and report.get("conclusion") == "success"
                        and report.get("revision") == v["revision"]
                    )
                    evidence = {
                        "trusted_host_report": report,
                        "expected_revision": v["revision"],
                    }
                elif kind == "human":
                    passed = False
                    evidence = {
                        "reason": "Human evidence requires external GateEngine authority"
                    }
                else:
                    raise PolicyError(f"Unknown oracle: {kind}")
                failure = None if passed else "TEST_FAILURE"
            except PolicyError as e:
                passed = False
                failure = "POLICY_VIOLATION"
                evidence = {"error": str(e)}
            except asyncio.TimeoutError:
                passed = False
                failure = "ENVIRONMENT_FAILURE"
                evidence = {"error": "Verifier timeout"}
            except Exception as e:
                passed = False
                failure = "ENVIRONMENT_FAILURE"
                evidence = {"error": f"{type(e).__name__}: {e}"}
            results.append(
                {
                    "schema_version": "1.0",
                    "kind": kind,
                    "passed": passed,
                    "failure_class": failure,
                    "evidence": evidence,
                    "duration_seconds": time.time() - started,
                }
            )
        return {
            "passed": bool(results) and all(r["passed"] for r in results),
            "results": results,
        }
