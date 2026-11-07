from __future__ import annotations
import copy
from fnmatch import fnmatchcase
from pathlib import PurePosixPath
from .util import PolicyError, digest

REQUIRED = {
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
}


def overlaps(a, b):
    """Conservative: wildcard scopes sharing a literal root may overlap."""
    if a == b or fnmatchcase(a, b) or fnmatchcase(b, a):
        return True

    def prefix(s):
        return s.split("*")[0].split("?")[0].rstrip("/")

    x, y = prefix(a), prefix(b)
    return not x or not y or x.startswith(y + "/") or y.startswith(x + "/") or x == y


def ancestors(units, node):
    result = set()

    def visit(n):
        for dep in units[n]["dependencies"]:
            d = dep["unit"]
            if d not in result:
                result.add(d)
                visit(d)

    visit(node)
    return result


def descendants(graph, node):
    found = set()
    while True:
        extra = {
            u["id"]
            for u in graph["units"]
            if any(d["unit"] in found | {node} for d in u["dependencies"])
        }
        if extra <= found:
            return found
        found |= extra


def validate_graph(graph, model=None):
    errors = []
    if graph.get("schema_version") != "1.0":
        errors.append("Unsupported graph schema_version")
    units = graph.get("units", [])
    if not units:
        errors.append("Empty graph")
    ids = [u.get("id") for u in units]
    if len(set(ids)) != len(ids):
        errors.append("Duplicate unit id")
    index = {u.get("id"): u for u in units}
    for u in units:
        uid = u.get("id")
        missing = REQUIRED - set(u)
        if missing:
            errors.append(f"{uid}: missing {sorted(missing)}")
            continue
        if (
            not isinstance(uid, str)
            or not uid
            or any(
                c
                not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
                for c in uid
            )
        ):
            errors.append("Unsafe unit id")
        if not u["requirement_ids"] or not u["verifiers"] or not u["acceptance"]:
            errors.append(f"{uid}: no requirement/oracle/acceptance")
        if not 1 <= u["max_attempts"] <= 10 or u["timeout_seconds"] <= 0:
            errors.append(f"{uid}: invalid budget/timeout")
        if u["risk"] not in ("LOW", "MEDIUM", "HIGH"):
            errors.append(f"{uid}: invalid risk")
        if set(u["budget"]) != {"max_cost", "max_tokens"} or any(
            v < 0 for v in u["budget"].values()
        ):
            errors.append(f"{uid}: invalid budget")
        for p in u["file_scope"]:
            if (
                PurePosixPath(p).is_absolute()
                or ".." in PurePosixPath(p).parts
                or "\\" in p
                or p.startswith((".lgo", "openspec", ".git", "verification"))
            ):
                errors.append(f"{uid}: unsafe scope {p}")
        if not u["file_scope"]:
            errors.append(f"{uid}: empty file scope")
        for dep in u["dependencies"]:
            if dep.get("unit") not in index or dep.get("unit") == uid:
                errors.append(f"{uid}: missing/self dependency")
            if not dep.get("reason"):
                errors.append(f"{uid}: edge without justification")
    if errors:
        raise PolicyError("; ".join(errors))
    visiting = set()
    done = set()

    def walk(n):
        if n in visiting:
            raise PolicyError(f"DAG cycle at {n}")
        if n in done:
            return
        visiting.add(n)
        for d in index[n]["dependencies"]:
            walk(d["unit"])
        visiting.remove(n)
        done.add(n)

    for n in index:
        walk(n)
    # A consumed artifact must have exactly one declared producer or an external input.
    producers = {}
    for u in units:
        for output in u["outputs"]:
            producers.setdefault(output, []).append(u["id"])
    external = set(graph.get("external_inputs", []))
    for u in units:
        for inp in u["inputs"]:
            owners = producers.get(inp, [])
            if not owners and inp not in external:
                errors.append(f"{u['id']}: input without producer {inp}")
            if len(owners) > 1:
                errors.append(f"Ambiguous producers: {inp}")
            for owner in owners:
                if owner != u["id"] and owner not in ancestors(index, u["id"]):
                    errors.append(f"{u['id']}: missing dependency on producer {owner}")
    for i, a in enumerate(units):
        for b in units[i + 1 :]:
            conflict = any(
                overlaps(x, y) for x in a["file_scope"] for y in b["file_scope"]
            )
            related = a["id"] in ancestors(index, b["id"]) or b["id"] in ancestors(
                index, a["id"]
            )
            locked = bool(set(a["resources"]) & set(b["resources"]))
            if conflict and not related and not locked:
                errors.append(
                    f"Predictable write conflict {a['id']} / {b['id']}; require dependency or resource lock"
                )
    if model:
        tasks = {t["id"] for t in model["tasks"]}
        reqs = {r["id"] for r in model["requirements"]}
        for u in units:
            if u["task_id"] not in tasks:
                errors.append(f"Unknown source task {u['task_id']}")
            if not set(u["requirement_ids"]) <= reqs:
                errors.append(f"Unknown requirements {u['id']}")
        if tasks - {u["task_id"] for u in units}:
            errors.append("Tasks without work units")
        if reqs - set(r for u in units for r in u["requirement_ids"]):
            errors.append("Requirements without work units")
    if errors:
        raise PolicyError("; ".join(errors))
    return graph


def build_plan(model, bindings, rules=()):
    """Explicit semantic bindings, never inferred from task order or names."""
    g = copy.deepcopy(bindings)
    g.update(
        schema_version="1.0",
        change_id=model["id"],
        spec_hash=model.get("spec_hash", digest(model["artifacts"])),
    )
    # Derive real dataflow edges from declared artifacts, never task wording/order.
    producers = {}
    for u in g["units"]:
        for artifact in u["outputs"]:
            producers.setdefault(artifact, []).append(u["id"])
    for u in g["units"]:
        u.setdefault("priority", 0)
        for artifact in u["inputs"]:
            owners = producers.get(artifact, [])
            if len(owners) > 1:
                raise PolicyError(f"Ambiguous producers: {artifact}")
            for owner in owners:
                if owner != u["id"] and not any(
                    d["unit"] == owner for d in u["dependencies"]
                ):
                    u["dependencies"].append(
                        {
                            "unit": owner,
                            "reason": f"Consumes declared artifact {artifact} produced by {owner}",
                        }
                    )
    applied = []
    for rule in rules:
        if rule.get("status") == "ACTIVE" and rule.get("kind") == "resource_constraint":
            scope = rule["constraint"]["scope"]
            resource = rule["constraint"]["resource"]
            for u in g["units"]:
                if any(overlaps(scope, p) for p in u["file_scope"]):
                    if resource not in u["resources"]:
                        u["resources"].append(resource)
            applied.append({"id": rule["id"], "version": rule["version"]})
    g["applied_rules"] = applied
    validate_graph(g, model)
    from .contracts import validate_contract

    validate_contract("execution_graph", g)
    return g


def mermaid(graph):
    lines = ["flowchart TD"]
    aliases = {u["id"]: f"n{i}" for i, u in enumerate(graph["units"])}
    for u in graph["units"]:
        lines.append(f'  {aliases[u["id"]]}["{u["id"]}"]')
    for u in graph["units"]:
        for dep in u["dependencies"]:
            lines.append(f"  {aliases[dep['unit']]} --> {aliases[u['id']]}")
    return "\n".join(lines)
