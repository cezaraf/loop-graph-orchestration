"""Measured local events. No synthetic token, cost or utilization claims."""

from __future__ import annotations


def report(store, run):
    events = store.events(run["id"])
    nodes = run["nodes"]
    units = {u["id"]: u for u in run["graph"]["units"]}
    scheduled = [e for e in events if e["kind"] == "scheduled"]
    durations = {
        uid: sum(h.get("duration_seconds", 0) for h in n["history"])
        for uid, n in nodes.items()
    }
    memo = {}

    def path(uid):
        if uid not in memo:
            preds = [path(d["unit"]) for d in units[uid]["dependencies"]]
            best = max(preds, key=lambda x: x[0], default=(0, []))
            memo[uid] = (best[0] + durations[uid], best[1] + [uid])
        return memo[uid]

    critical = max((path(uid) for uid in units), default=(0, []))
    intervals = []
    for uid, n in nodes.items():
        if n.get("started_at") and n.get("finished_at"):
            intervals.append((n["started_at"], n["finished_at"]))
    elapsed = max((b for a, b in intervals), default=0) - min(
        (a for a, b in intervals), default=0
    )
    first = sum(n["state"] == "PASSED" and n["attempts"] == 1 for n in nodes.values())
    corrections = [e for e in events if e["kind"] == "correction"]
    preserved = set()
    for correction in corrections:
        failed = correction["unit"]
        from .graph import ancestors

        related = ancestors(units, failed) | {failed}
        for e in events:
            if (
                e["kind"] == "transition"
                and e.get("state") == "PASSED"
                and e["timestamp"] < correction["timestamp"]
                and e["unit"] not in related
                and nodes[e["unit"]]["attempts"] == 1
            ):
                preserved.add(e["unit"])
    return {
        "schema_version": "1.0",
        "run_id": run["id"],
        "state": run["state"],
        "worker_span_wall_seconds": max(0, elapsed),
        "run_elapsed_seconds": max(
            (e["timestamp"] for e in events), default=run["created_at"]
        )
        - run["created_at"],
        "worker_seconds": sum(durations.values()),
        "peak_workers": max((e["active_workers"] for e in scheduled), default=0),
        "critical_path": critical[1],
        "critical_path_worker_seconds": critical[0],
        "bottlenecks": sorted(durations, key=durations.get, reverse=True)[:3],
        "first_attempt_pass_rate": first / len(nodes) if nodes else 0,
        "attempts": {uid: n["attempts"] for uid, n in nodes.items()},
        "corrections": sum(e["kind"] == "correction" for e in events),
        "replans": sum(e["kind"] == "replan" for e in events),
        "invalidations": sum(e["kind"] == "invalidated" for e in events),
        "human_interventions_required": sum(
            e["kind"] == "gate"
            and e.get("decision", {}).get("verdict") == "HUMAN_APPROVAL_REQUIRED"
            for e in events
        ),
        "validated_independent_units_preserved": len(preserved),
        "avoided_cost_estimate": None,
        "adapter_reported_cost": sum(n["cost"] for n in nodes.values()),
        "adapter_reported_tokens": sum(n["tokens"] for n in nodes.values()),
        "cost_source": "mock fixtures"
        if all(u["agent"]["adapter"] == "mock" for u in units.values())
        else "adapter reports; not billing proof",
        "integration_passed": run["integration"].get("passed", False),
        "queue_wait_seconds": {
            uid: max(
                0, n.get("started_at", 0) - n.get("ready_at", n.get("started_at", 0))
            )
            for uid, n in nodes.items()
        },
        "failure_classes": [
            e.get("feedback", {}).get("failure_class")
            for e in events
            if e["kind"] == "correction"
        ],
        "learning_events": sum(e["kind"].startswith("learning_") for e in events),
    }
