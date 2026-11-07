from __future__ import annotations
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import yaml
from . import __version__
from .engine import Engine, load_config
from .graph import build_plan, validate_graph, mermaid
from .gates import ApprovalAuthority, GateEngine
from .learning import LearningEngine
from .observability import report
from .openspec import OpenSpecAdapter
from .util import PolicyError, atomic_json


def parser():
    p = argparse.ArgumentParser(
        prog="lgo",
        description="OpenSpec define; Graph agenda; Loop verifica; Gate autoriza.",
    )
    p.add_argument("--version", action="version", version=__version__)
    p.add_argument(
        "--root",
        type=Path,
        default=Path.cwd(),
        help="Raiz do projeto consumidor (antes do comando)",
    )
    p.add_argument("--json", action="store_true", help="JSON estruturado")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Validar sem executar/mutar (antes do comando)",
    )
    sub = p.add_subparsers(dest="command", required=True)
    for name in ["init", "doctor", "update", "uninstall"]:
        sub.add_parser(name)
    for name in [
        "inspect",
        "plan",
        "validate-plan",
        "run",
        "status",
        "graph",
        "explain",
        "prepare-archive",
        "sync-progress",
    ]:
        s = sub.add_parser(name)
        s.add_argument("change")
        if name == "plan":
            s.add_argument("--bindings", type=Path)
        if name == "run":
            s.add_argument("--stop-after", type=int)
            s.add_argument("--approval", type=Path)
        if name == "graph":
            s.add_argument(
                "--format", choices=["mermaid", "json", "dot"], default="mermaid"
            )
        if name == "prepare-archive":
            s.add_argument("--approval", type=Path)
    for name in [
        "resume",
        "verify",
        "learn",
        "report",
        "cancel",
        "integrate",
        "export",
    ]:
        s = sub.add_parser(name)
        s.add_argument("run_id")
        if name in ("resume", "integrate"):
            s.add_argument("--approval", type=Path)
    s = sub.add_parser("invalidate")
    s.add_argument("run_id")
    s.add_argument("unit")
    s.add_argument("--reason", required=True)
    s = sub.add_parser("replan")
    s.add_argument("run_id")
    s.add_argument("--plan", type=Path, required=True)
    s.add_argument("--reason", required=True)
    return p


def emit(data, json_mode):
    if isinstance(data, str):
        print(data)
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))


def main(argv=None):
    args = parser().parse_args(argv)
    root = args.root.resolve()
    cmd = args.command
    try:
        result, code = dispatch(args, root, cmd)
        emit(result, args.json)
        return code
    except KeyboardInterrupt:
        emit(
            {"error": "Interrompido; use resume para recuperar checkpoints."}, args.json
        )
        return 130
    except Exception as e:
        emit({"error": type(e).__name__, "reason": str(e)}, args.json)
        return 2


def dispatch(args, root, cmd):
    if not root.is_dir():
        raise PolicyError("Raiz inexistente")
    config_path = root / ".lgo/config.yaml"
    if cmd == "init":
        if config_path.exists():
            return {
                "created": False,
                "reason": "Configuração preservada",
                "config": load_config(root),
            }, 0
        value = {
            "schema_version": "1.0",
            "concurrency": 3,
            "max_patch_bytes": 1048576,
            "commands": {},
            "allow_process_agents": False,
            "retention_days": 30,
        }
        if not args.dry_run:
            config_path.parent.mkdir(parents=True, exist_ok=True)
            config_path.write_text(yaml.safe_dump(value, sort_keys=False))
            (root / ".lgo/.gitignore").write_text(
                "state.sqlite*\nruns/\nscheduler.lock\n"
            )
        return {
            "created": not args.dry_run,
            "dry_run": args.dry_run,
            "config": value,
            "next_action": "Crie bindings explícitos e verificadores; OpenSpec é inicializado pela CLI oficial.",
        }, 0
    if cmd in ("doctor", "update", "uninstall"):
        config = load_config(root)
        if cmd == "uninstall":
            return {
                "executed": False,
                "instructions": "Pare o scheduler, exporte evidências e remova .lgo somente após revisão; preserve openspec e código. pip uninstall lgo-engine.",
            }, 0
        if cmd == "update":
            return {
                "executed": False,
                "schema_version": config["schema_version"],
                "migration_required": False,
                "instructions": "Versão1.0 preservada; atualize pacote e valide antes de executar.",
            }, 0
        a = OpenSpecAdapter(root)
        return {
            "configuration": "PASS",
            "openspec_version": a.version,
            "platform": sys.platform,
            "distributed": False,
        }, 0
    adapter = OpenSpecAdapter(root)
    if cmd == "inspect":
        return adapter.load(args.change), 0

    def plan_path(c):
        return root / ".lgo/plans" / f"{c}.json"

    engine = None
    if cmd in ("plan", "validate-plan", "run", "graph", "explain"):
        model = adapter.load(args.change)
        path = plan_path(args.change)
        if cmd == "plan":
            bindings = args.bindings or root / ".lgo/bindings" / f"{args.change}.json"
            if not bindings.exists():
                return {
                    "error": "Bindings necessários",
                    "next_action": "Defina entradas/saídas/dependências/escopos/oracles, sem inferir pela ordem das tasks.",
                    "expected": str(bindings),
                }, 2
            config = load_config(root)
            # Read-only planning does not create a state store.
            rules = []
            if (root / ".lgo/state.sqlite").exists():
                from .state import StateStore

                store = StateStore(root / ".lgo")
                rules = store.rules()
                store.close()
            graph = build_plan(model, json.loads(bindings.read_text()), rules)
            if not args.dry_run:
                atomic_json(path, graph)
            return {"dry_run": args.dry_run, "plan": graph, "path": str(path)}, 0
        if not path.exists():
            raise PolicyError("Plano ausente; execute plan --bindings")
        graph = json.loads(path.read_text())
        validate_graph(graph, model)
        if graph["spec_hash"] != model["spec_hash"]:
            raise PolicyError("Plano obsoleto em relação ao OpenSpec")
        if cmd == "validate-plan":
            return {"valid": True, "change": args.change}, 0
        if cmd == "graph":
            if args.format == "json":
                return graph, 0
            if args.format == "dot":
                return "digraph lgo {\n" + "\n".join(
                    f'"{d["unit"]}" -> "{u["id"]}";'
                    for u in graph["units"]
                    for d in u["dependencies"]
                ) + "\n}", 0
            return mermaid(graph), 0
        if cmd == "explain":
            return {
                "change": args.change,
                "units": [
                    {
                        "id": u["id"],
                        "task": u["task_id"],
                        "requirements": u["requirement_ids"],
                        "dependencies": u["dependencies"],
                        "risk": u["risk"],
                        "resources": u["resources"],
                        "verifiers": u["verifiers"],
                    }
                    for u in graph["units"]
                ],
            }, 0
        if args.dry_run:
            return {
                "dry_run": True,
                "valid": True,
                "units": len(graph["units"]),
                "will_execute": False,
            }, 0
    # Authority key is host configuration, never sourced from a worker/plan.
    key = os.environ.get("LGO_AUTHORITY_KEY_FILE")
    authority = ApprovalAuthority(key, root) if key else None
    engine = Engine(root, gate=GateEngine(authority))
    try:
        if cmd == "run":
            run = engine.start(graph)
            token = json.loads(args.approval.read_text()) if args.approval else None
            run = asyncio.run(
                engine.execute(run["id"], stop_after=args.stop_after, approval=token)
            )
            return report(engine.store, run), 0 if run["state"] == "ACCEPTED" else 3
        if cmd == "integrate":
            run = engine.store.get(args.run_id)
            if args.dry_run or not args.approval:
                return engine.gate.authorize(run, action="integrate"), 3
            result = engine.integrate_consumer(
                args.run_id, json.loads(args.approval.read_text())
            )
            return result, 0 if result.get("integrated_into_consumer") else 3
        if cmd == "export":
            run = engine.store.get(args.run_id)
            engine.assert_integrity(run)
            from .util import safe_path

            paths = {
                p
                for n in run["nodes"].values()
                if n["state"] == "PASSED"
                for p in n.get("merge", {}).get("hashes", {})
            }
            return {
                "run_id": run["id"],
                "files": {
                    p: safe_path(run["workspace"], p).read_text()
                    if safe_path(run["workspace"], p).exists()
                    else None
                    for p in sorted(paths)
                },
                "evidence_digest": run.get("evidence_digest"),
                "applied": False,
            }, 0
        if cmd == "status":
            run = engine.store.latest(args.change)
            return (
                {"run": None}
                if not run
                else {
                    "run_id": run["id"],
                    "state": run["state"],
                    "nodes": {
                        k: {
                            "state": v["state"],
                            "attempts": v["attempts"],
                            "integrated": v["integrated"],
                        }
                        for k, v in run["nodes"].items()
                    },
                    "workspace": run["workspace"],
                }
            ), 0
        if cmd == "resume":
            run = engine.store.get(args.run_id)
            if not args.dry_run:
                run = asyncio.run(
                    engine.execute(
                        args.run_id,
                        approval=json.loads(args.approval.read_text())
                        if args.approval
                        else None,
                    )
                )
            return report(engine.store, run), 0 if run[
                "state"
            ] == "ACCEPTED" or args.dry_run else 3
        if cmd == "verify":
            run = (
                engine.store.get(args.run_id)
                if args.dry_run
                else asyncio.run(engine.verify(args.run_id))
            )
            return report(engine.store, run), 0 if run["state"] == "ACCEPTED" else 3
        if cmd == "report":
            return report(engine.store, engine.store.get(args.run_id)), 0
        if cmd == "learn":
            run = engine.store.get(args.run_id)
            return {
                "candidates": []
                if args.dry_run
                else LearningEngine(engine.store, engine.gate).propose(run),
                "dry_run": args.dry_run,
            }, 0
        if cmd == "invalidate":
            if args.dry_run:
                return {"dry_run": True, "unit": args.unit}, 0
            run = engine.invalidate(args.run_id, args.unit, args.reason)
            return {"run_id": run["id"], "state": run["state"]}, 0
        if cmd == "replan":
            graph = json.loads(args.plan.read_text())
            run = engine.store.get(args.run_id)
            model = adapter.load(run["graph"]["change_id"])
            validate_graph(graph, model)
            if graph["spec_hash"] != model["spec_hash"]:
                raise PolicyError("Replan stale spec")
            if not args.dry_run:
                run = engine.replan(args.run_id, graph, args.reason)
            return {
                "run_id": run["id"],
                "state": run["state"],
                "dry_run": args.dry_run,
            }, 0
        if cmd == "cancel":
            if not args.dry_run:
                from .state import run_lock

                with run_lock(root / ".lgo"):
                    run = engine.store.get(args.run_id)
                    for uid, n in run["nodes"].items():
                        if n["state"] not in ("PASSED", "FAILED", "CANCELLED"):
                            engine.store.transition(run, uid, "CANCELLED")
                    run["state"] = "CANCELLED"
                    engine._checkpoint(run)
            return {
                "run_id": args.run_id,
                "state": "CANCELLED",
                "dry_run": args.dry_run,
            }, 0
        if cmd in ("sync-progress", "prepare-archive"):
            run = engine.store.latest(args.change)
            if not run:
                raise PolicyError("Nenhuma execução com evidências")
            engine.assert_integrity(run)
            if cmd == "sync-progress":
                from .util import file_hash, safe_path

                accepted = [
                    u["task_id"]
                    for u in run["graph"]["units"]
                    if run["nodes"][u["id"]]["state"] == "PASSED"
                    and run["nodes"][u["id"]]["integrated"]
                    and all(
                        file_hash(safe_path(root, p)) == h
                        for p, h in run["nodes"][u["id"]]
                        .get("merge", {})
                        .get("hashes", {})
                        .items()
                    )
                ]
                # For tasks split among several units every mapped unit must pass.
                accepted = [
                    t
                    for t in accepted
                    if all(
                        run["nodes"][u["id"]]["state"] == "PASSED"
                        for u in run["graph"]["units"]
                        if u["task_id"] == t
                    )
                ]
                result = {
                    "accepted_task_ids": sorted(set(accepted)),
                    "dry_run": args.dry_run,
                }
                if not args.dry_run:
                    result = adapter.sync_tasks(
                        args.change,
                        accepted,
                        expected_spec_hash=run["graph"]["spec_hash"],
                    )
                return result, 0
            quality = engine.gate.quality(run)
            token = json.loads(args.approval.read_text()) if args.approval else None
            authority_gate = engine.gate.authorize(run, token=token, action="archive")
            result = adapter.prepare_archive(
                args.change,
                all_accepted=quality["verdict"] == "PASS",
                integration_passed=run["integration"]["passed"],
                gate_passed=authority_gate["verdict"] == "PASS",
            )
            result["gate"] = authority_gate
            result["quality"] = quality
            # Preparation must also prove integrated delivery to user's checkout.
            result["delivery"] = engine.delivery_status(run)
            if not result["delivery"]["integrated_into_consumer"]:
                result["ready"] = False
                if "DELIVERY_NOT_CONFIRMED" not in result["blockers"]:
                    result["blockers"].append("DELIVERY_NOT_CONFIRMED")
            return result, 0 if result["ready"] else 3
        raise PolicyError(f"Unknown command {cmd}")
    finally:
        engine.close()


if __name__ == "__main__":
    sys.exit(main())
