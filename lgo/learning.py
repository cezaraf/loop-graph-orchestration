from __future__ import annotations
from .util import digest, PolicyError


class LearningEngine:
    def __init__(self, store, gate):
        self.store = store
        self.gate = gate

    def propose(self, run):
        if self.gate.quality(run)["verdict"] != "PASS":
            raise PolicyError("Learning requires validated integration")
        failures = [
            e for e in self.store.events(run["id"]) if e["kind"] == "correction"
        ]
        if not failures:
            return []
        finding = "A localized verification failure was corrected without rerunning independent passed units."
        affected = {e["unit"] for e in failures}
        scopes = sorted(
            {
                scope
                for u in run["graph"]["units"]
                if u["id"] in affected
                for scope in u["file_scope"]
            }
        )
        if not scopes:
            raise PolicyError("No scoped correction evidence")
        chosen_scope = scopes[0]
        resource = "contract-review-" + digest(chosen_scope)[:8]
        rule = {
            "schema_version": "1.0",
            "id": "learning-"
            + digest(
                {
                    "change": run["graph"]["change_id"],
                    "finding": finding,
                    "scope": chosen_scope,
                }
            )[:12],
            "finding": finding,
            "root_cause": "An implementation violated an external acceptance oracle.",
            "kind": "resource_constraint",
            "category": "Constraint",
            "target": "graph-planner",
            "status": "PROPOSED",
            "version": 1,
            "constraint": {"scope": chosen_scope, "resource": resource},
            "evidence": {
                "run_id": run["id"],
                "evidence_digest": run["evidence_digest"],
                "corrections": len(failures),
            },
            "applicability": f"Only projects with {chosen_scope} and the same oracle family; proposed serialization is a conservative experiment, not a proven causal fix.",
            "regressions": [],
            "revoked": False,
        }
        existing = next((r for r in self.store.rules() if r["id"] == rule["id"]), None)
        if existing:
            return [existing]
        self.store.save_rule(rule)
        self.store.event(run["id"], "learning_proposed", candidate=rule["id"])
        return [rule]

    def promote(self, run, rule_id, token, regression_run_ids):
        rule = next(r for r in self.store.rules() if r["id"] == rule_id)
        if rule["status"] != "PROPOSED":
            raise PolicyError("Only proposed candidates can be promoted")
        # At least two independently validated runs, including the originating one.
        ids = set(regression_run_ids)
        if len(ids) < 2 or rule["evidence"]["run_id"] not in ids:
            raise PolicyError("Generalization needs two validated regression runs")
        for rid in ids:
            r = self.store.get(rid)
            if self.gate.quality(r)["verdict"] != "PASS":
                raise PolicyError("Regression run not accepted")
            if r["graph"]["change_id"] != run["graph"]["change_id"]:
                raise PolicyError("Regression applicability mismatch")
            if rid != rule["evidence"]["run_id"] and not any(
                a["id"] == rule["id"] and a["version"] == rule["version"]
                for a in r["graph"].get("applied_rules", [])
            ):
                raise PolicyError(
                    "Regression must exercise candidate constraint in an isolated trial plan"
                )
        binding = digest({"rule": rule, "regressions": sorted(ids)})
        if not self.gate.authority or not self.gate.authority.verify(
            token, binding, "promote-learning"
        ):
            raise PolicyError("External signed rule approval required")
        for other in self.store.rules():
            if (
                other["status"] == "ACTIVE"
                and other["constraint"]["scope"] == rule["constraint"]["scope"]
                and other["constraint"] != rule["constraint"]
            ):
                raise PolicyError(
                    "Contradictory constraint requires explicit resolution"
                )
        rule.update(
            status="ACTIVE",
            version=rule["version"] + 1,
            regressions=sorted(ids),
            approval_actor=token["payload"]["actor"],
        )
        self.store.save_rule(rule)
        self.store.event(
            run["id"], "learning_promoted", candidate=rule_id, version=rule["version"]
        )
        return rule

    def revoke(self, run, rule_id, token):
        rule = next(r for r in self.store.rules() if r["id"] == rule_id)
        binding = digest(rule)
        if not self.gate.authority or not self.gate.authority.verify(
            token, binding, "revoke-learning"
        ):
            raise PolicyError("Signed revocation required")
        rule.update(status="REVOKED", revoked=True, version=rule["version"] + 1)
        self.store.save_rule(rule)
        self.store.event(run["id"], "learning_revoked", candidate=rule_id)
        return rule
